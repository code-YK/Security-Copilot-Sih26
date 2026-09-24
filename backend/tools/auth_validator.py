"""
`validate_email_auth` tool — SPF / DKIM / DMARC for a raw email.

Two sources, reported side by side:
  * reported — the topmost Authentication-Results header, i.e. what the
    recipient's own mail server concluded at delivery time;
  * computed — our own live check: SPF by evaluating the delivering IP
    against the sender's record (fetched/parsed by checkdmarc), DKIM via
    dkimpy, DMARC from the policy record plus alignment.
The receiver's verdict wins when present (DKIM keys rotate and DNS
changes after delivery); otherwise the computed one is used. Every DNS
lookup degrades to "temperror" instead of failing the tool.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re

from langchain_core.tools import tool

from logger import get_logger
from tools.header_analyzer import analyze_headers, looks_like_rfc822, parse_message
from utils.validators import same_registrable_domain

logger = get_logger(__name__)

_AUTH_RESULT_RE = re.compile(r"\b(spf|dkim|dmarc)\s*=\s*([a-z]+)", re.IGNORECASE)
_DKIM_TAG_RE = re.compile(r"\b([ds])\s*=\s*([^;\s]+)")
_DNS_TIMEOUT = 3.0
_MAX_SPF_A_LOOKUPS = 10


def _reported_results(msg) -> dict:
    header = msg.get("Authentication-Results")
    found: dict[str, str] = {}
    for mech, result in _AUTH_RESULT_RE.findall(str(header or "")):
        found.setdefault(mech.lower(), result.lower())
    if "spf" not in found and msg.get("Received-SPF"):
        found["spf"] = str(msg["Received-SPF"]).split()[0].lower()
    return found


def _resolve(name: str, rdtype: str) -> list[str]:
    import dns.resolver

    try:
        return [r.to_text().rstrip(".") for r in dns.resolver.resolve(name, rdtype, lifetime=_DNS_TIMEOUT)]
    except Exception:  # noqa: BLE001 — a failed lookup is just "no match" for this mechanism
        return []


def _host_ips(host: str) -> list[str]:
    return _resolve(host, "A") + _resolve(host, "AAAA")


def spf_eval(parsed: dict, ip: str, domain: str, budget: list[int]) -> str | None:
    """Walk checkdmarc's parsed SPF tree; returns the first matching mechanism's action, else the `all` action."""
    addr = ipaddress.ip_address(ip)
    for m in parsed.get("mechanisms") or []:
        mech, action, value = m.get("mechanism"), m.get("action"), m.get("value") or ""
        if mech in ("ip4", "ip6"):
            try:
                if addr in ipaddress.ip_network(value, strict=False):
                    return action
            except ValueError:
                continue
        elif mech == "include" and isinstance(m.get("parsed"), dict):
            if spf_eval(m["parsed"], ip, value, budget) == "pass":
                return action
        elif mech in ("a", "mx") and budget[0] > 0:
            budget[0] -= 1
            target = value.split("/")[0] or domain
            hosts = [target] if mech == "a" else [h.split()[-1] for h in _resolve(target, "MX")][:5]
            if any(ip in _host_ips(h) for h in hosts):
                return action
    redirect = parsed.get("redirect")
    if isinstance(redirect, dict) and isinstance(redirect.get("parsed"), dict):
        return spf_eval(redirect["parsed"], ip, redirect.get("domain") or domain, budget)
    return parsed.get("all")


def _compute_spf(domain: str | None, ip: str | None) -> dict:
    if not domain:
        return {"result": "none", "detail": "No envelope sender domain."}
    try:
        import checkdmarc.spf

        record = checkdmarc.spf.check_spf(domain, timeout=_DNS_TIMEOUT)
    except Exception as exc:  # noqa: BLE001
        return {"result": "temperror", "detail": f"SPF lookup failed: {exc}"}
    if not record.get("valid"):
        error = str(record.get("error") or "")
        # A missing record is "none"; a present-but-broken one is a permanent error.
        result = "none" if ("not exist" in error or "not found" in error.lower() or not record.get("record")) else "permerror"
        return {"result": result, "record": record.get("record"), "detail": error}
    if not ip:
        return {"result": "neutral", "record": record["record"], "detail": "No delivering IP to evaluate against."}
    action = spf_eval(record.get("parsed") or {}, ip, domain, [_MAX_SPF_A_LOOKUPS]) or "neutral"
    return {"result": action, "record": record["record"], "detail": f"{ip} evaluated against {domain}'s SPF record"}


def _compute_dkim(raw_email: str, msg) -> dict:
    sig = msg.get("DKIM-Signature")
    if not sig:
        return {"result": "none", "detail": "Message is not DKIM-signed."}
    tags = dict(_DKIM_TAG_RE.findall(str(sig)))
    try:
        import dkim

        ok = dkim.verify(raw_email.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8", "surrogateescape"))
        result = "pass" if ok else "fail"
    except Exception as exc:  # noqa: BLE001 — DNS/key errors are temporary, not a forgery signal
        return {"result": "temperror", "domain": tags.get("d"), "selector": tags.get("s"), "detail": str(exc)}
    return {"result": result, "domain": tags.get("d"), "selector": tags.get("s")}


def _fetch_dmarc(domain: str | None) -> dict:
    if not domain:
        return {"policy": None, "record": None}
    try:
        import checkdmarc.dmarc

        record = checkdmarc.dmarc.check_dmarc(domain, timeout=_DNS_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 — includes "no DMARC record", which is itself a finding
        return {"policy": None, "record": None, "detail": str(exc)}
    tags = record.get("tags") or {}
    return {"policy": (tags.get("p") or {}).get("value"), "record": record.get("record")}


def _aligned(a: str | None, b: str | None) -> bool | None:
    if not a or not b:
        return None
    return same_registrable_domain(a, b)  # relaxed alignment (organizational domain)


def _pick(reported: str | None, computed: str) -> str:
    return reported or computed


async def validate(raw_email: str) -> dict:
    msg = parse_message(raw_email)
    headers = analyze_headers(msg)
    reported = _reported_results(msg)
    from_domain = headers["from_domain"]
    envelope = headers["return_path"] or headers["from"]
    spf_domain = envelope.rsplit("@", 1)[1] if envelope and "@" in envelope else None

    spf, dkim_res, dmarc_rec = await asyncio.gather(
        asyncio.to_thread(_compute_spf, spf_domain, headers["delivering_ip"]),
        asyncio.to_thread(_compute_dkim, raw_email, msg),
        asyncio.to_thread(_fetch_dmarc, from_domain),
    )

    spf_result = _pick(reported.get("spf"), spf["result"])
    dkim_result = _pick(reported.get("dkim"), dkim_res["result"])
    spf_aligned = _aligned(spf_domain, from_domain)
    dkim_aligned = _aligned(dkim_res.get("domain"), from_domain)

    if dmarc_rec["record"]:
        passed = (spf_result == "pass" and spf_aligned) or (dkim_result == "pass" and dkim_aligned)
        dmarc_computed = "pass" if passed else "fail"
    else:
        dmarc_computed = "none"
    dmarc_result = _pick(reported.get("dmarc"), dmarc_computed)

    return {
        "available": True,
        "from_domain": from_domain,
        "spf": {**spf, "result": spf_result, "computed": spf["result"], "reported": reported.get("spf"),
                "domain": spf_domain, "ip": headers["delivering_ip"]},
        "dkim": {**dkim_res, "result": dkim_result, "computed": dkim_res["result"], "reported": reported.get("dkim")},
        "dmarc": {**dmarc_rec, "result": dmarc_result, "computed": dmarc_computed, "reported": reported.get("dmarc")},
        "alignment": {"spf_aligned": spf_aligned, "dkim_aligned": dkim_aligned},
    }


@tool
async def validate_email_auth(raw_email: str) -> dict:
    """Checks a raw email's SPF, DKIM and DMARC results (pass/fail/none) and whether the SPF/DKIM domains align with the visible From: domain. A hard SPF or DMARC fail on a brand's domain is strong evidence of spoofing."""
    if not looks_like_rfc822(raw_email):
        return {"available": False, "detail": "Input has no RFC822 header block."}
    try:
        return await validate(raw_email)
    except Exception as exc:  # noqa: BLE001 — degrade like every other lookup tool
        logger.warning("validate_email_auth failed: %s", exc)
        return {"available": False, "detail": f"Authentication check failed: {exc}"}
