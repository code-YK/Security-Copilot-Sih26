"""
POST /quick-check-email — fast pre-check for the extension popup's and
the Gmail auto-scanner's automatic "you're looking at an email" scan.

Two-stage architecture, links resolved first because their verdict feeds
into the text check as context:

  Stage 1 — if the email contains links: score each one with the same
    corroborated ML+VirusTotal check the URL quick-check uses
    (tools/link_reputation.py) — VT is authoritative when available, the
    same escalation/de-escalation rules already proven on real false
    positives (a live phishing storefront the ONNX model alone missed,
    login.microsoftonline.com the ONNX model alone falsely flagged). The
    worst (highest-ranked) result across all links becomes the link
    verdict, and — if it's not "safe" — a one-line summary of it is
    passed into Jev as context, so a dangerous link's presence informs
    how Jev reads the surrounding text instead of judging it in
    isolation.

  Stage 2 — Jev (tools/jev_client.py, with the link context if any) and
    the local BERT text model run in parallel on the email text.

  Final label = the worst of the link verdict (if any) and the two text
    signals. No WHOIS here — domain-age lookups are deliberately reserved
    for the full agent's slower, thorough investigation
    (agent/forensics_node.py / tools/domain_reputation.py), not this
    instant path.

Every signal is independently timeout-bounded
(QUICK_CHECK_NETWORK_TIMEOUT_SECONDS) and degrades to "just skip it" on
failure — a Jev outage, a VT rate-limit, or a slow network never blocks
or breaks this endpoint, it just falls back to whichever signals came
back in time.
"""
from __future__ import annotations

import asyncio
from urllib.parse import urlparse

from fastapi import APIRouter

from api.schemas import QuickCheckEmailRequest
from config import get_settings
from tools.content_classifier import _score_text
from tools.jev_client import jev_score_text
from tools.link_reputation import evaluate_url

router = APIRouter()

_DANGEROUS_THRESHOLD = 0.7
_SUSPICIOUS_THRESHOLD = 0.4
_LABEL_RANK = {"safe": 0, "unknown": 0, "suspicious": 1, "dangerous": 2}


def _label_for_score(score: float) -> str:
    if score >= _DANGEROUS_THRESHOLD:
        return "dangerous"
    if score >= _SUSPICIOUS_THRESHOLD:
        return "suspicious"
    return "safe"


def _domain_of(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"http://{url}")
    return (parsed.hostname or url).lower()


async def _with_timeout(coro, timeout: float):
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception as exc:  # noqa: BLE001 — TimeoutError or whatever the coro itself raised
        return {"label": "unknown", "confidence": 0.0, "source": "error", "detail": str(exc)}


def _worst(results: list[dict]) -> dict:
    """The highest-ranked (worst) result, ties broken by higher confidence."""
    return max(results, key=lambda r: (_LABEL_RANK.get(r["label"], 0), r.get("confidence", 0.0)))


@router.post("/quick-check-email", tags=["Email"])
async def quick_check_email(payload: QuickCheckEmailRequest) -> dict:
    text = payload.text.strip()
    if not text:
        return {"label": "unknown", "confidence": 0.0, "source": "error", "detail": "Empty input"}

    settings = get_settings()
    timeout = settings.QUICK_CHECK_NETWORK_TIMEOUT_SECONDS

    # Dedupe by domain and cap how many distinct domains we check, so a
    # "click here" x5 email or a long footer of tracking links doesn't
    # blow out the latency budget.
    seen_domains: set[str] = set()
    unique_links: list[str] = []
    for link in payload.links:
        domain = _domain_of(link)
        if domain and domain not in seen_domains:
            seen_domains.add(domain)
            unique_links.append(link)
    unique_links = unique_links[: settings.QUICK_CHECK_MAX_LINKS]

    # --- Stage 1: links first, so their verdict can inform the text check ---
    link_results: list[dict] = []
    if unique_links:
        link_results = await asyncio.gather(
            *[_with_timeout(evaluate_url(link), timeout) for link in unique_links]
        )

    link_verdict = _worst(link_results) if link_results else None
    link_context = None
    if link_verdict is not None and link_verdict["label"] != "safe":
        link_context = (
            f"This email contains a link that a {link_verdict['source']} check found to be "
            f"{link_verdict['label']} ({link_verdict.get('domain', 'unknown domain')})."
        )

    # --- Stage 2: text signals, Jev informed by the link verdict if any ---
    try:
        ml_text_task = asyncio.to_thread(_score_text, text)
        jev_task = _with_timeout(jev_score_text(text, link_context), timeout)
        ml_text_result, jev_result = await asyncio.gather(ml_text_task, jev_task)
    except Exception as exc:  # noqa: BLE001 — the local ML model itself failed to load/run
        return {"label": "unknown", "confidence": 0.0, "source": "error", "detail": str(exc)}

    ml_score = ml_text_result["phishing_score"]
    jev_available = jev_result.get("available", False)
    jev_score = jev_result.get("phishing_score") if jev_available else None

    # Jev is authoritative for the text verdict when available — same role
    # VirusTotal plays for links. The local BERT model alone is prone to
    # false positives on ordinary transactional/notification phrasing
    # (verified: plain bank-notification text scored 1.0 "phishing" from
    # the ML model alone, while Jev — already independently benchmarked as
    # better-calibrated — scored the same text 0.61, "suspicious"). Using
    # ML as the sole signal only when Jev is unavailable keeps a single
    # noisy model from single-handedly forcing "dangerous" on a text Jev
    # actively disagrees with, while still catching cases Jev might miss
    # via the safety-net max() with the link verdict below.
    if jev_available:
        text_result = {"label": _label_for_score(jev_score), "confidence": jev_score, "source": "jev"}
    else:
        text_result = {"label": _label_for_score(ml_score), "confidence": ml_score, "source": "ml_model"}

    overall = _worst([text_result] + ([link_verdict] if link_verdict is not None else []))

    # "ml_model" always ran and is always shown in breakdown, but only
    # listed here as a decision source when it actually drove the label
    # (i.e. Jev was unavailable) — otherwise it's informational only.
    sources = [text_result["source"]]
    if jev_available and text_result["source"] != "ml_model":
        sources.insert(0, "ml_model")  # ran, informational
    if link_verdict is not None:
        sources.append(link_verdict["source"])

    return {
        "label": overall["label"],
        "confidence": round(overall["confidence"], 4),
        "source": "+".join(sources),
        "breakdown": {
            "email": {"ml_score": ml_score, "jev": jev_result},
            "links": link_results,
            "link_verdict": link_verdict,
        },
    }
