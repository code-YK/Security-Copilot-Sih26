"""
Forensics node — runs the email-forensics tools deterministically before
the agent whenever the input is a raw RFC822 message, so header/auth/
origin evidence is always collected (not left to the LLM's discretion)
and a hard authentication failure can feed the verdict in output_node.

Each result is stored in `state["forensics"]` keyed by tool name, and
agent/graph.py records each one as a tool call, so history, the markdown
report and the dashboard all pick them up the same way as agent calls.
"""
from __future__ import annotations

import json

from langgraph.config import get_stream_writer

from agent.state import AgentState
from logger import get_logger
from tools.attachment_scanner import scan_attachments
from tools.auth_validator import validate_email_auth
from tools.domain_reputation import domain_reputation
from tools.geolocate import geolocate_ip
from tools.header_analyzer import analyze_email_headers, extract_body, looks_like_rfc822, parse_message

logger = get_logger(__name__)


def _announce(step: str) -> None:
    """Tell a streaming caller which forensic step is starting *now*.

    LangGraph's "updates" stream only reports a node once it has finished,
    so without this all five checks surfaced together at the end of the
    node (~15s in) and live progress sat on "Starting investigation" until
    then. graph.py's stream_case_traced also listens on the "custom" stream
    mode and turns these into progress labels as each step begins."""
    try:
        get_stream_writer()({"forensics_step": step})
    except Exception:  # noqa: BLE001 — not inside a streaming run (e.g. a direct ainvoke): nothing to tell
        pass


async def _safe(tool, args: dict) -> dict:
    _announce(tool.name)
    try:
        return await tool.ainvoke(args)
    except Exception as exc:  # noqa: BLE001 — one failed check must not sink the investigation
        logger.warning("Forensics step %s failed: %s", tool.name, exc)
        return {"available": False, "detail": f"{tool.name} failed: {exc}"}


async def forensics_node(state: AgentState) -> dict:
    raw = state["raw_input"]
    if state["case_type"] != "email" or not looks_like_rfc822(raw):
        return {}

    forensics: dict[str, dict] = {}
    forensics["analyze_email_headers"] = await _safe(analyze_email_headers, {"raw_email": raw})
    forensics["validate_email_auth"] = await _safe(validate_email_auth, {"raw_email": raw})
    from_domain = forensics["analyze_email_headers"].get("from_domain")
    if from_domain:
        # Sender-domain age feeds attribution (established domain + valid auth = compromised account).
        forensics["domain_reputation"] = await _safe(domain_reputation, {"url": from_domain})
    origin_ip = forensics["analyze_email_headers"].get("origin_ip")
    if origin_ip:
        forensics["geolocate_ip"] = await _safe(geolocate_ip, {"ip": origin_ip})
    forensics["scan_attachments"] = await _safe(scan_attachments, {"raw_email": raw})

    body, _ = extract_body(parse_message(raw))
    return {"forensics": forensics, "email_body": body}


def summarize_forensics(forensics: dict) -> str:
    """Compact text block for the agent's seed message — drops bulky fields the LLM doesn't need."""
    trimmed = {}
    for name, result in forensics.items():
        result = dict(result)
        if name == "scan_attachments":
            result["attachments"] = [
                {k: a.get(k) for k in ("filename", "detected_mime", "sha256", "flags")} for a in result.get("attachments") or []
            ]
        if name == "analyze_email_headers":
            result["received_chain"] = [
                {k: h.get(k) for k in ("index", "from_host", "ip", "timestamp", "flags")}
                for h in result.get("received_chain") or []
            ]
        trimmed[name] = result
    return json.dumps(trimmed, indent=1, default=str)[:6000]
