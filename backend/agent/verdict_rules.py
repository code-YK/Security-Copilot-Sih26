"""
Deterministic post-processing of the agent's verdict with forensic
evidence (agent/forensics_node.py). Plain if/else rules on purpose — every
point added to the risk score comes with a human-readable factor, so the
final number is explainable in a report.
"""
from __future__ import annotations

# Starting risk per verdict label, before forensic adjustments.
_BASE_RISK = {"legitimate": 0.05, "suspicious": 0.45, "impersonated": 0.7, "phishing": 0.85, "fraud-related": 0.9}
# Pre-SIH26106 labels, still present in old cache/history rows.
_LEGACY_LABELS = {"safe": "legitimate", "dangerous": "phishing"}
# A domain older than this that still passes authentication is "established".
_ESTABLISHED_DOMAIN_DAYS = 180


def normalize_label(label: str) -> str:
    return _LEGACY_LABELS.get(label, label if label in _BASE_RISK else "suspicious")


def forensic_risk(forensics: dict) -> tuple[float, list[str], bool]:
    """Returns (risk bump, explaining factors, whether a hard auth failure was seen)."""
    bump, factors, hard_fail = 0.0, [], False

    auth = forensics.get("validate_email_auth") or {}
    if auth.get("available"):
        domain = auth.get("from_domain")
        dmarc = auth.get("dmarc") or {}
        spf = (auth.get("spf") or {}).get("result")
        dkim = (auth.get("dkim") or {}).get("result")
        if dmarc.get("result") == "fail":
            bump += 0.30
            hard_fail = True
            factors.append(f"DMARC failed for {domain}" + (f" (published policy p={dmarc['policy']})" if dmarc.get("policy") else ""))
        if spf == "fail":
            bump += 0.20
            hard_fail = True
            factors.append("SPF hard-fail: the sending server is not authorised for the sender domain")
        elif spf == "softfail":
            bump += 0.10
            factors.append("SPF softfail: the sending server is probably not authorised for the sender domain")
        if dkim == "fail":
            bump += 0.15
            factors.append("DKIM signature failed verification (message altered or forged)")

    geo = forensics.get("geolocate_ip") or {}
    infra = geo.get("infrastructure") or {}
    if infra.get("is_tor"):
        bump += 0.15
        factors.append(f"Email originated from a TOR exit node ({geo.get('ip')})")
    elif infra.get("is_vpn"):
        bump += 0.10
        factors.append(f"Email originated from a known VPN range ({geo.get('ip')})")
    abuse = (geo.get("reputation") or {}).get("abuse_confidence_score") or 0
    if abuse >= 50:
        bump += 0.10
        factors.append(f"Origin IP has an AbuseIPDB confidence score of {abuse}%")

    attachments = forensics.get("scan_attachments") or {}
    codes = {f["code"] for f in attachments.get("flags") or []}
    if "clamav_detection" in codes:
        bump += 0.40
        factors.append("An attachment matched a ClamAV malware signature")
    if codes & {"double_extension", "executable", "type_mismatch"}:
        bump += 0.25
        factors.append("An attachment is an executable or disguises its real file type")
    if "office_macros" in codes:
        bump += 0.20
        factors.append("An Office attachment contains VBA macros")

    headers = forensics.get("analyze_email_headers") or {}
    for f in headers.get("flags") or []:
        if f.get("severity") in ("high", "medium"):
            bump += 0.05
            factors.append(f["detail"])

    return bump, factors, hard_fail


def _dmarc_failed(auth: dict) -> bool:
    return (auth.get("dmarc") or {}).get("result") == "fail"


def _spf_forged(auth: dict) -> bool:
    return (auth.get("spf") or {}).get("result") == "fail" and (auth.get("alignment") or {}).get("spf_aligned") is False


def _authenticated(auth: dict) -> bool:
    if (auth.get("dmarc") or {}).get("result") == "pass":
        return True
    align = auth.get("alignment") or {}
    return ((auth.get("spf") or {}).get("result") == "pass" and bool(align.get("spf_aligned"))) or \
        ((auth.get("dkim") or {}).get("result") == "pass" and bool(align.get("dkim_aligned")))


def attribute(label: str, forensics: dict | None) -> tuple[str, str]:
    """Who is probably behind a malicious email. Order matters: a forged sender outranks everything."""
    if label == "legitimate":
        return "unknown", "No malicious activity to attribute."
    forensics = forensics or {}
    auth = forensics.get("validate_email_auth") or {}
    if not auth.get("available"):
        return "unknown", "No email headers to attribute from."
    domain = auth.get("from_domain") or "the sender domain"
    infra = (forensics.get("geolocate_ip") or {}).get("infrastructure") or {}
    anonymized = bool(infra.get("anonymized"))
    whois = (forensics.get("domain_reputation") or {}).get("whois") or {}
    age = whois.get("age_days") if whois.get("available") else None

    if _dmarc_failed(auth) or _spf_forged(auth):
        return "spoofed_domain", f"The message claims to be from {domain} but fails that domain's SPF/DMARC checks — the sender forged an address they don't control."
    if _authenticated(auth):
        if age is not None and age >= _ESTABLISHED_DOMAIN_DAYS:
            return "compromised_account", f"The message is genuinely authenticated by {domain}, an established domain ({age} days old), yet is malicious — most likely a compromised mailbox or account on that domain."
        if anonymized:
            return "anonymized_infrastructure", f"The message authenticates for {domain} but was sent through TOR/VPN infrastructure to hide its origin."
        age_text = f"registered {age} days ago" if age is not None else "of unknown age"
        return "direct_actor", f"The attacker appears to own {domain} ({age_text}) and sent the message from their own infrastructure."
    if anonymized:
        return "anonymized_infrastructure", "The message was sent through TOR/VPN infrastructure to hide its origin."
    return "unknown", "Authentication results are inconclusive — not enough evidence to attribute."


def apply_forensics(verdict: dict, forensics: dict | None) -> dict:
    label = normalize_label(verdict.get("label", "suspicious"))
    risk = _BASE_RISK[label]
    factors: list[str] = []

    if forensics:
        bump, factors, hard_fail = forensic_risk(forensics)
        risk += bump
        auth = forensics.get("validate_email_auth") or {}
        if hard_fail and label == "legitimate":
            # A clean-looking body doesn't outweigh a failed sender authentication.
            label = "suspicious"
            factors.append("Verdict escalated from legitimate: sender authentication failed")
        if label == "suspicious" and _dmarc_failed(auth) and (auth.get("dmarc") or {}).get("policy"):
            # The domain publishes DMARC and this message fails it: the visible sender is forged.
            label = "impersonated"
            factors.append(f"Verdict escalated to impersonated: the From: domain {auth.get('from_domain')} did not authenticate this message")
        risk = max(risk, _BASE_RISK[label])

    attribution, attribution_reason = attribute(label, forensics)
    return {
        **verdict,
        "label": label,
        "risk_score": round(min(max(risk, 0.0), 1.0), 2),
        "risk_factors": factors,
        "attribution": attribution,
        "attribution_reason": attribution_reason,
    }
