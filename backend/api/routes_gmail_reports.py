"""
POST/GET /gmail-reports — a durable, bidirectional mapping between a
Gmail message id and the run_id of the full investigation already done
for it.

Written two ways:
  - POST /gmail-reports/pending, right when the Gmail add-on hands a raw
    email off to /email-drafts (before redirecting) — claims the message
    as "a check is already running" before any run_id exists (run_id is
    only assigned when the investigation *finishes* — see agent/graph.py
    stream_case_traced). Without this, two rapid clicks on "Check Report"
    (e.g. the user clicking again because the first scan takes a while)
    both see "no report yet" and each start their own full investigation
    — confirmed as a real bug: two independent runs for the same message,
    28 seconds apart. Expires after PENDING_TTL_SECONDS in case a run
    crashed or the browser tab was closed before finishing, so a stuck
    marker can't permanently block re-checking.
  - POST /gmail-reports, right after that /check-email(-stream)
    investigation finishes — overwrites the pending marker with the real
    run_id.

Read two ways:
  - by message_id (GET /gmail-reports/{message_id}) — the Gmail add-on
    checks this every time an email is opened, so a message that's
    already been checked shows its existing verdict instead of offering
    "Check Report" again, and one that's mid-check shows "already
    running" instead of starting a second one.
  - by run_id (GET /gmail-reports/by-run/{run_id}) — the dashboard's case
    page uses this to show a "View in Gmail" link back to the original
    message, when the case actually came from the Gmail add-on.

A flat JSON file, not SQLite — this is a small index; the actual case
data lives in history.db and is looked up via history.get_run() by
run_id, this file only remembers the message_id<->run_id association.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import get_settings
from history import get_run

router = APIRouter()
_lock = threading.Lock()

# A pending marker older than this is treated as stale (crashed run, closed
# tab, etc.) and ignored — falls back to "no report yet" so the message can
# be checked again instead of being stuck "in progress" forever.
_PENDING_TTL_SECONDS = 5 * 60


class GmailReportRequest(BaseModel):
    message_id: str
    run_id: str


class GmailReportPendingRequest(BaseModel):
    message_id: str
    draft_id: str


class _MessageEntry(BaseModel):
    status: str  # "pending" | "done"
    run_id: str | None = None
    draft_id: str | None = None
    created_at: float = 0.0


class _Store(BaseModel):
    by_message: dict[str, _MessageEntry] = {}
    by_run: dict[str, str] = {}


def _store_path() -> Path:
    return Path(get_settings().HISTORY_DB_PATH).parent / "gmail_reports.json"


def _load() -> _Store:
    path = _store_path()
    if not path.exists():
        return _Store()
    try:
        return _Store.model_validate_json(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        return _Store()


def _save(store: _Store) -> None:
    path = _store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(store.model_dump_json(), encoding="utf-8")


@router.post("/gmail-reports/pending", tags=["Email"])
async def mark_gmail_report_pending(payload: GmailReportPendingRequest) -> dict:
    with _lock:
        store = _load()
        existing = store.by_message.get(payload.message_id)
        # Never clobber an already-finished report with a stale pending
        # marker — only claim the message if nothing done exists yet.
        if existing is None or existing.status != "done":
            store.by_message[payload.message_id] = _MessageEntry(
                status="pending", draft_id=payload.draft_id, created_at=time.time()
            )
            _save(store)
    return {"ok": True}


@router.post("/gmail-reports", tags=["Email"])
async def save_gmail_report(payload: GmailReportRequest) -> dict:
    with _lock:
        store = _load()
        store.by_message[payload.message_id] = _MessageEntry(status="done", run_id=payload.run_id)
        store.by_run[payload.run_id] = payload.message_id
        _save(store)
    return {"ok": True}


def _verdict_summary(run_id: str) -> dict:
    run = get_run(run_id)
    if run is None:
        # The mapping outlived the case itself (e.g. retention swept it).
        raise HTTPException(status_code=404, detail="No report for this message yet")
    verdict = run.get("verdict") or {}
    return {
        "status": "done",
        "run_id": run_id,
        "label": verdict.get("label", "unknown"),
        "confidence": verdict.get("confidence"),
        "risk_score": verdict.get("risk_score"),
    }


@router.get("/gmail-reports/by-run/{run_id}", tags=["Email"])
async def get_gmail_message_for_run(run_id: str) -> dict:
    with _lock:
        store = _load()
    message_id = store.by_run.get(run_id)
    if message_id is None:
        raise HTTPException(status_code=404, detail="This case has no associated Gmail message")
    return {"message_id": message_id}


@router.get("/gmail-reports/{message_id}", tags=["Email"])
async def get_gmail_report(message_id: str) -> dict:
    with _lock:
        store = _load()
    entry = store.by_message.get(message_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="No report for this message yet")
    if entry.status == "pending":
        if time.time() - entry.created_at > _PENDING_TTL_SECONDS:
            raise HTTPException(status_code=404, detail="No report for this message yet")
        return {"status": "pending", "draft_id": entry.draft_id}
    return _verdict_summary(entry.run_id)
