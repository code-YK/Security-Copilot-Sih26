"""
Shared ML + VirusTotal corroboration for a single URL — the core logic
`routes_quick_check.py` uses for the extension's per-navigation check,
factored out so `routes_quick_check_email.py` can reuse the exact same,
already-tested escalation/de-escalation rules instead of scoring links
with the raw ONNX model alone.

Scoring the ONNX URL model alone is known to be unreliable on its own
(see routes_quick_check.py's module docstring for two confirmed real
examples: a live phishing storefront scored "safe," and
login.microsoftonline.com scored "dangerous") — that's exactly why this
exists as one shared, corroborated implementation rather than two
separately-maintained ones that can drift out of sync with each other.
"""
from __future__ import annotations

import time

from config import get_settings
from logger import get_logger
from tools.content_classifier import score_url
from tools.domain_reputation import _lookup_virustotal
from utils.validators import extract_domain

logger = get_logger(__name__)

_DANGEROUS_THRESHOLD = 0.7
_SUSPICIOUS_THRESHOLD = 0.4

_VT_DANGEROUS_MALICIOUS_COUNT = 3
_VT_SUSPICIOUS_MALICIOUS_COUNT = 1
_VT_HARMLESS_OVERRIDE_COUNT = 20
_VT_HARMLESS_OVERRIDE_MAX_BAD = 1

_VT_CACHE_TTL_SECONDS = 6 * 3600
_vt_cache: dict[str, tuple[float, dict]] = {}

_LABEL_RANK = {"safe": 0, "unknown": 0, "suspicious": 1, "dangerous": 2}


def _label_for_score(score: float) -> str:
    if score >= _DANGEROUS_THRESHOLD:
        return "dangerous"
    if score >= _SUSPICIOUS_THRESHOLD:
        return "suspicious"
    return "safe"


async def _vt_lookup_cached(domain: str) -> dict:
    now = time.time()
    hit = _vt_cache.get(domain)
    if hit is not None and (now - hit[0]) < _VT_CACHE_TTL_SECONDS:
        return hit[1]

    result = await _lookup_virustotal(domain)
    if result.get("available"):
        _vt_cache[domain] = (now, result)
    return result


def _label_for_vt(vt_result: dict) -> tuple[str, float]:
    malicious = vt_result.get("malicious_count", 0)
    if malicious >= _VT_DANGEROUS_MALICIOUS_COUNT:
        return "dangerous", max(0.85, vt_result.get("reputation_score", 0.0))
    if malicious >= _VT_SUSPICIOUS_MALICIOUS_COUNT:
        return "suspicious", max(0.5, vt_result.get("reputation_score", 0.0))
    return "safe", vt_result.get("reputation_score", 0.0)


async def evaluate_url(url: str) -> dict:
    """Scores a URL's domain with the local ONNX model, then corroborates
    with VirusTotal — VT is the authoritative signal when available (it
    can both escalate a too-lenient ML verdict and de-escalate a
    too-harsh one); the ML score alone is the fallback when VT is
    unavailable (no key, or the domain isn't in VT yet)."""
    domain = extract_domain(url)
    ml_result = score_url(f"https://{domain}/")
    if "error" in ml_result:
        return {"label": "unknown", "confidence": 0.0, "source": "error", "domain": domain}

    ml_score = ml_result.get("phishing_score", 0.0)
    ml_label = _label_for_score(ml_score)

    if not get_settings().VT_API_KEY:
        return {"label": ml_label, "confidence": ml_score, "source": "ml_model", "domain": domain}

    vt_result = await _vt_lookup_cached(domain)
    if not vt_result.get("available"):
        return {"label": ml_label, "confidence": ml_score, "source": "ml_model", "domain": domain}

    vt_label, vt_confidence = _label_for_vt(vt_result)
    if _LABEL_RANK[vt_label] > _LABEL_RANK[ml_label]:
        logger.info(
            "link check escalated %s: ML said %s (%.2f), VT found %d malicious vendors",
            domain, ml_label, ml_score, vt_result.get("malicious_count", 0),
        )
        return {"label": vt_label, "confidence": vt_confidence, "source": "virustotal", "domain": domain}

    vt_bad_count = vt_result.get("malicious_count", 0) + vt_result.get("suspicious_count", 0)
    if (
        ml_label != "safe"
        and vt_bad_count <= _VT_HARMLESS_OVERRIDE_MAX_BAD
        and vt_result.get("harmless_count", 0) >= _VT_HARMLESS_OVERRIDE_COUNT
    ):
        logger.info(
            "link check de-escalated %s: ML said %s (%.2f), VT found %d vendors actively vouching it's harmless (vs %d flagging it)",
            domain, ml_label, ml_score, vt_result.get("harmless_count", 0), vt_bad_count,
        )
        return {"label": "safe", "confidence": vt_result.get("reputation_score", 0.0), "source": "virustotal", "domain": domain}

    return {"label": ml_label, "confidence": ml_score, "source": "ml_model", "domain": domain}
