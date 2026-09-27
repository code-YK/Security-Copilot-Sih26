"""
POST/GET /email-drafts — a short-lived handoff slot for raw email content
between a caller that can't easily carry a large payload in a URL (the
Gmail Add-on's "Check Report" button) and the dashboard, which reads the
id back out of a query param and auto-starts the real /check-email scan
client-side. Not persisted, not linked to history — purely a relay.
"""
from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

_TTL_SECONDS = 600  # plenty for "click a button, browser tab opens a second later"
_MAX_DRAFTS = 200  # small in-memory cap so this can never grow unbounded
_drafts: dict[str, tuple[float, str, str | None]] = {}


class EmailDraftRequest(BaseModel):
    text: str
    # The Gmail message this came from, if the caller is the Gmail add-on —
    # carried through so the dashboard can report the finished run_id back
    # to /gmail-reports keyed by this id, and link back to the email itself.
    message_id: str | None = None


def _evict_expired() -> None:
    now = time.time()
    expired = [key for key, (created, _, _) in _drafts.items() if now - created > _TTL_SECONDS]
    for key in expired:
        del _drafts[key]


@router.post("/email-drafts", tags=["Email"])
async def create_email_draft(payload: EmailDraftRequest) -> dict:
    _evict_expired()
    if len(_drafts) >= _MAX_DRAFTS:
        oldest = min(_drafts, key=lambda k: _drafts[k][0])
        del _drafts[oldest]

    draft_id = uuid.uuid4().hex
    _drafts[draft_id] = (time.time(), payload.text, payload.message_id)
    return {"id": draft_id}


@router.get("/email-drafts/{draft_id}", tags=["Email"])
async def get_email_draft(draft_id: str) -> dict:
    _evict_expired()
    entry = _drafts.get(draft_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Draft not found or expired")
    # NOT a one-time read: React's dev-mode double-effect-invocation (and an
    # ordinary page refresh) both legitimately re-fetch the same draft id —
    # deleting it after the first read turned that into a guaranteed 404 on
    # the second, harmless fetch. The TTL eviction above is enough cleanup.
    return {"text": entry[1], "message_id": entry[2]}
