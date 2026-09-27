"""
Jev (`typesafe/jev-1.13`) — a second opinion for quick-check-email, alongside
the local BERT text model (content_classifier.py). Served through OpenRouter's
alpha Decisions API (not the standard /v1/chat/completions path llm_client.py
uses), authenticated with the same OPENROUTER_API_KEY — no separate signup.

This is a quick-check-only signal: unlike the full agent's LLM, Jev only
answers a single yes/no probability question, it doesn't call tools, so it
can't replace agent_node.py's model. It exists purely to corroborate (or
challenge) the local model's instant verdict, the same role VirusTotal plays
for the URL quick-check in routes_quick_check.py.

Degrades independently, like every other tool in this project: any failure
(network, timeout, non-2xx, unexpected shape) returns `available: False`
rather than raising, so a Jev outage never breaks the quick-check endpoint —
it just falls back to the local model alone.
"""
from __future__ import annotations

import httpx

from config import get_settings
from logger import get_logger

logger = get_logger(__name__)

_INSTRUCTIONS = "Is this email a phishing attempt?"
_CRITERIA = {
    "true": "Tries to trick the reader into giving credentials, money, or clicking malicious links",
    "false": "Legitimate email with no deceptive intent",
}


async def jev_score_text(text: str, link_context: str | None = None) -> dict:
    """`link_context`: an optional one-line summary of what the corroborated
    VT+ML link check already found (e.g. "This email contains a link VirusTotal
    flagged as dangerous: evil.example.com"), prepended so Jev's read of the
    email's language is informed by the link verdict instead of judging the
    text in isolation."""
    settings = get_settings()
    if not settings.OPENROUTER_API_KEY:
        return {"available": False, "detail": "OPENROUTER_API_KEY not configured"}

    state = text[:5000]
    if link_context:
        state = f"[{link_context}]\n\n{state}"

    try:
        async with httpx.AsyncClient(timeout=settings.QUICK_CHECK_NETWORK_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.JEV_DECISIONS_URL,
                headers={"Authorization": f"Bearer {settings.OPENROUTER_API_KEY}"},
                json={
                    "model": settings.JEV_MODEL_ID,
                    "state": state,
                    "questions": {
                        "is_phishing": {"type": "noul", "instructions": _INSTRUCTIONS, "criteria": _CRITERIA}
                    },
                },
            )
            response.raise_for_status()
            body = response.json()
        score = float(body["answers"]["is_phishing"]["noul"])
    except Exception as exc:  # noqa: BLE001 — timeout, 4xx/5xx, malformed body: never fail the caller
        logger.warning("Jev quick-check failed: %s", exc)
        return {"available": False, "detail": f"Jev unavailable: {exc}"}

    return {"available": True, "model": settings.JEV_MODEL_ID, "phishing_score": round(score, 4)}
