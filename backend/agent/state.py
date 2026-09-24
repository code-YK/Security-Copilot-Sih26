"""
Agent state shape (spec section 2).

This is the single object threaded through every node in the graph —
router -> agent -> tools -> output. Add a new field here (and nowhere
else) if a future node needs to carry new information through the loop.
"""
from __future__ import annotations

from typing import Annotated, Literal, Optional, TypedDict

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

CaseType = Literal["link", "email"]


class LegitimateAlternative(TypedDict):
    title: str
    url: str


class Verdict(TypedDict, total=False):
    # SIH26106's five classes (see agent_node.py's prompt for definitions).
    label: Literal["legitimate", "suspicious", "impersonated", "phishing", "fraud-related"]
    confidence: float
    reason: str
    mitigation: Optional[str]
    # Populated via web_search when the agent suspects brand impersonation —
    # the real company's actual site(s), so the verdict can say "and here's
    # where you probably meant to go," not just "this is dangerous."
    legitimate_alternatives: list[LegitimateAlternative]
    # agent/verdict_rules.py: 0..1 fraud/risk score and the reasons behind it.
    risk_score: float
    risk_factors: list[str]
    # agent/verdict_rules.py::attribute — who is probably behind it, and why.
    attribution: Literal["compromised_account", "spoofed_domain", "anonymized_infrastructure", "direct_actor", "unknown"]
    attribution_reason: str


class AgentState(TypedDict):
    case_type: CaseType
    raw_input: str
    messages: Annotated[list[BaseMessage], add_messages]
    verdict: Optional[Verdict]
    # case_type == "email" only — links found in the email (regex-extracted
    # from the body text, plus real anchor hrefs when the caller has DOM
    # access, e.g. the extension popup), already deduped to one URL per
    # domain and capped (see utils.validators.dedupe_links_by_domain) so
    # the agent's per-link investigation work stays bounded. None/empty for
    # every other case type.
    email_links: Optional[list[str]]
    # Raw RFC822 email cases only (agent/forensics_node.py): results of the
    # deterministic forensics tools keyed by tool name, and the decoded body.
    forensics: Optional[dict]
    email_body: Optional[str]
