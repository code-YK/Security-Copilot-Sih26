"""
Router node — spec section 2's deterministic fast path.

For `case_type == "link"`, checks a static blocklist then a SQLite
cache keyed by URL (24h TTL) before ever calling the LLM. Email
cases always fall through to the agent — there's no URL to look up.
"""
from __future__ import annotations

from agent.state import AgentState, Verdict
from agent.verdict_rules import normalize_label
from cache.blocklist import is_blocklisted
from cache.sqlite_cache import get_cached_verdict
from logger import get_logger

logger = get_logger(__name__)


def router_node(state: AgentState) -> dict:
    if state["case_type"] != "link":
        return {}

    url = state["raw_input"]

    if is_blocklisted(url):
        logger.info("Router: %s matched the static blocklist", url)
        return {
            "verdict": Verdict(
                label="phishing", confidence=1.0, reason="URL matches the static blocklist", mitigation=None,
                risk_score=1.0, risk_factors=["Domain is on the static blocklist"]
            )
        }

    cached = get_cached_verdict(url)
    if cached is not None:
        logger.info("Router: %s served from cache", url)
        return {"verdict": {**cached, "label": normalize_label(cached.get("label", "suspicious"))}}

    return {}


def route_after_router(state: AgentState) -> str:
    """Conditional edge: straight to Output if the router already resolved the case, else on to forensics + the Agent."""
    return "output" if state.get("verdict") else "forensics"
