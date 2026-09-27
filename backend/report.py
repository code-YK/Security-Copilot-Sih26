"""
Per-case investigation report (markdown) — one saved file per case with
everything the agent gathered: the verdict, every tool call in order,
the screenshot, and (for `inspect_website`) the full redirect chain a
URL took, not just its final destination.

Not agent- or LangGraph-specific — it just formats whatever evidence
it's handed, so anything that runs a case (today: cli.py) can produce
one the same way; the API can reuse this later without changes here.
"""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Optional

from config import get_settings
from utils.screenshots import sanitize_for_filename


def _format_inspect_website(artifact: dict, screenshot_path: Optional[str]) -> list[str]:
    lines = [f"- **Final URL:** `{artifact.get('final_url')}`", f"- **Status code:** {artifact.get('status_code')}"]

    if artifact.get("navigation_error"):
        lines.append(f"- **Navigation failed:** {artifact['navigation_error']}")
    if artifact.get("error"):
        lines.append(f"- **Error:** {artifact['error']}")

    chain = artifact.get("redirect_chain") or []
    if len(chain) > 1:
        lines.append(f"- **Redirect chain** ({len(chain)} hops):")
        for i, hop in enumerate(chain, start=1):
            lines.append(f"  {i}. `{hop.get('url')}` -> {hop.get('status')}")
    elif chain:
        lines.append(f"- **Redirect chain:** none (loaded directly, status {chain[0].get('status')})")

    forms = artifact.get("forms") or []
    if forms:
        lines.append(f"- **Forms found:** {len(forms)}")
        for f in forms:
            pw = "has a password field" if f.get("has_password_field") else "no password field"
            lines.append(f"  - submits to `{f.get('action')}` ({pw})")
    else:
        lines.append("- **Forms found:** none")

    lines.append(f"- **Outbound requests:** {len(artifact.get('network_requests') or [])}")

    if screenshot_path:
        rel = Path(screenshot_path).resolve()
        lines.append(f"- **Screenshot:** `{rel}`")
        lines.append(f"\n  ![screenshot]({rel})")

    page_text = (artifact.get("page_text") or "").strip()
    if page_text:
        preview = page_text[:800] + ("..." if len(page_text) > 800 else "")
        lines.append(f"- **Page text (excerpt):**\n\n  ```\n  {preview}\n  ```")

    return lines


def _format_domain_reputation(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    lines = [f"- **Domain:** `{artifact.get('domain')}`"]

    whois = artifact.get("whois", {})
    lines.append(f"- **WHOIS:** {whois.get('detail')}" if whois.get("available") else f"- **WHOIS:** unavailable ({whois.get('detail')})")

    vt = artifact.get("virustotal", {})
    if vt.get("available"):
        lines.append(
            f"- **VirusTotal:** {vt.get('malicious_count')} malicious, {vt.get('suspicious_count')} suspicious, "
            f"{vt.get('harmless_count')} harmless (reputation score {vt.get('reputation_score')})"
        )
        for f in vt.get("flagged_by") or []:
            lines.append(f"  - {f.get('vendor')}: **{f.get('category')}** ({f.get('result')})")
        categories = vt.get("categories") or {}
        if categories:
            cat_str = ", ".join(f"{vendor}: {label}" for vendor, label in categories.items())
            lines.append(f"- **Threat categorization:** {cat_str}")
    else:
        lines.append(f"- **VirusTotal:** unavailable ({vt.get('detail')})")

    return lines


def _format_content_classifier(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if artifact.get("error"):
        return [f"- **Error:** {artifact['error']}"]
    return [
        f"- **Model:** {artifact.get('model')}",
        f"- **Input type:** {artifact.get('input_type')}",
        f"- **Phishing score:** {artifact.get('phishing_score')}",
        f"- **Label:** {artifact.get('label')}",
    ]


def _format_web_search(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if not artifact.get("available"):
        return [f"- **Search unavailable:** {artifact.get('detail')}"]
    lines = [f"- **Query:** {artifact.get('query')}"]
    for r in artifact.get("results") or []:
        lines.append(f"  - [{r.get('title')}]({r.get('url')})")
    return lines


def _format_headers(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if not artifact.get("available"):
        return [f"- {artifact.get('detail')}"]
    lines = [
        f"- **From:** `{artifact.get('from')}` · **Return-Path:** `{artifact.get('return_path')}` · **Reply-To:** `{artifact.get('reply_to')}`",
        f"- **Subject:** {artifact.get('subject')}",
        f"- **Origin IP (hop-0):** {artifact.get('origin_ip') or 'not found'}",
        "- **Received chain (oldest first):**",
    ]
    for hop in artifact.get("received_chain") or []:
        flags = f" ({', '.join(hop['flags'])})" if hop.get("flags") else ""
        lines.append(f"  {hop['index']}. `{hop.get('from_host')}` [{hop.get('ip')}] -> `{hop.get('by_host')}` {hop.get('timestamp') or ''}{flags}")
    for f in artifact.get("flags") or []:
        lines.append(f"- **Anomaly ({f['severity']}):** {f['detail']}")
    return lines


def _format_auth(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if not artifact.get("available"):
        return [f"- {artifact.get('detail')}"]
    lines = []
    for mech in ("spf", "dkim", "dmarc"):
        check = artifact.get(mech) or {}
        extra = f", policy p={check['policy']}" if check.get("policy") else ""
        lines.append(f"- **{mech.upper()}:** {check.get('result')} (reported: {check.get('reported')}, computed: {check.get('computed')}{extra})")
    align = artifact.get("alignment") or {}
    lines.append(f"- **Aligned with From domain:** SPF {align.get('spf_aligned')}, DKIM {align.get('dkim_aligned')}")
    return lines


def _format_geolocate(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if not artifact.get("available"):
        return [f"- `{artifact.get('ip')}`: {artifact.get('detail')}"]
    loc = artifact.get("location") or {}
    infra = artifact.get("infrastructure") or {}
    place = ", ".join(p for p in (loc.get("city"), loc.get("region"), loc.get("country")) if p)
    lines = [
        f"- **IP:** `{artifact.get('ip')}` — {place or 'unknown location'} ({loc.get('source')})",
        f"- **ISP / org:** {loc.get('isp')} / {loc.get('org')} {loc.get('asn') or ''}",
        f"- **TOR:** {infra.get('is_tor')} · **VPN:** {infra.get('is_vpn')} · **Hosting:** {infra.get('is_hosting')}",
    ]
    rep = artifact.get("reputation") or {}
    if rep.get("available"):
        lines.append(f"- **AbuseIPDB:** {rep.get('abuse_confidence_score')}% confidence, {rep.get('total_reports')} reports")
    return lines


def _format_attachments(artifact: dict, _screenshot_path: Optional[str]) -> list[str]:
    if not artifact.get("available"):
        return [f"- {artifact.get('detail')}"]
    if not artifact.get("count"):
        return ["- No attachments."]
    lines = []
    for a in artifact.get("attachments") or []:
        lines.append(f"- `{a['filename']}` — {a.get('detected_mime')}, {a['size']} bytes, sha256 `{a['sha256']}`")
        lines.extend(f"  - **{f['code']}:** {f['detail']}" for f in a.get("flags") or [])
        pdf = a.get("pdf")
        if pdf and pdf.get("available"):
            lines.append(f"  - PDF content: {pdf.get('page_count')} page(s) read in sandbox — no execution, structure/text only")
            for link in pdf.get("link_verdicts") or []:
                lines.append(f"    - link `{link['url']}` → **{link['label']}** ({link.get('source')})")
            classification = pdf.get("text_classification")
            if classification:
                lines.append(f"    - extracted text classified: {classification.get('label')} ({classification.get('phishing_score', 0):.0%} phishing-style)")
    return lines


_FORMATTERS = {
    "analyze_email_headers": _format_headers,
    "validate_email_auth": _format_auth,
    "geolocate_ip": _format_geolocate,
    "scan_attachments": _format_attachments,
    "inspect_website": _format_inspect_website,
    "domain_reputation": _format_domain_reputation,
    "content_classifier": _format_content_classifier,
    "web_search": _format_web_search,
}


def generate_report(case_type: str, raw_input: str, tool_calls: list[dict[str, Any]], verdict: Optional[dict]) -> str:
    """`tool_calls` is a list of {"tool", "args", "artifact", "screenshot_path"}
    dicts in the order they ran. Writes a markdown report, returns its path."""
    settings = get_settings()
    report_dir = Path(settings.REPORT_DIR)
    report_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now()
    label = sanitize_for_filename(raw_input) if case_type != "email" else "email"
    report_path = report_dir / f"{now:%Y%m%d_%H%M%S}_{label}.md"

    input_display = raw_input if case_type != "email" else raw_input[:300] + ("..." if len(raw_input) > 300 else "")
    input_display = " ".join(input_display.split())
    verdict = verdict or {"label": "inconclusive", "confidence": 0.0, "reason": "No verdict was reached."}

    lines = [
        "# security-copilot case report",
        "",
        f"- **Case type:** {case_type}",
        f"- **Input:** {input_display}",
        f"- **Generated:** {now.isoformat(timespec='seconds')}",
        "",
        "## Verdict",
        "",
        f"- **Label:** {verdict.get('label')}",
        f"- **Confidence:** {verdict.get('confidence')}",
        f"- **Risk score:** {verdict.get('risk_score')}",
        f"- **Attribution:** {verdict.get('attribution')} — {verdict.get('attribution_reason')}",
        f"- **Reason:** {verdict.get('reason')}",
    ]
    for factor in verdict.get("risk_factors") or []:
        lines.append(f"  - Risk factor: {factor}")
    if verdict.get("mitigation"):
        lines.append(f"- **Mitigation:** {verdict['mitigation']}")
    alternatives = verdict.get("legitimate_alternatives") or []
    if alternatives:
        lines.append("- **The real site is probably one of these:**")
        for alt in alternatives:
            lines.append(f"  - [{alt.get('title')}]({alt.get('url')})")
    lines.append("")

    if tool_calls:
        lines.append("## Investigation timeline")
        lines.append("")
        for i, call in enumerate(tool_calls, start=1):
            tool_name = call["tool"]
            args_str = ", ".join(f"{k}={v!r}" for k, v in (call.get("args") or {}).items())
            lines.append(f"### {i}. `{tool_name}`({args_str})")
            lines.append("")

            formatter = _FORMATTERS.get(tool_name)
            artifact = call.get("artifact") or {}
            if formatter:
                lines.extend(formatter(artifact, call.get("screenshot_path")))
            else:
                lines.append(f"- {artifact}")
            lines.append("")
    else:
        lines.append("*Resolved by the router's fast path (blocklist/cache) — no tools were called.*")
        lines.append("")

    # UTF-8 explicitly: the LLM's text can contain non-ASCII (em/non-breaking
    # dashes, smart quotes, emoji). Without this, Windows' default cp1252 codec
    # raises UnicodeEncodeError and the whole /check-* request 500s.
    report_path.write_text("\n".join(lines), encoding="utf-8")
    return str(report_path)
