"""
GET /runs, GET /runs/{run_id} — run history for the UI (history.py).

Not part of the original spec (sections 1-15) — added so past
investigations are actually browsable from the small history UI
(index.html) instead of only ever existing as terminal scrollback or a
one-off markdown file.
"""
from __future__ import annotations

from typing import Optional

import asyncio

from fastapi import APIRouter, Query

from exceptions import NotFoundError
from history import get_run, list_runs
from tools.correlation_graph import campaign_for_run

router = APIRouter()

# Friendly view names the UI can pass, mapped to the underlying case_type values.
_VIEW_CASE_TYPES = {
    "phishing": ["link", "email"],
    "email": ["email"],
    "link": ["link"],
}


@router.get("/runs", tags=["History"])
async def get_runs(
    limit: int = Query(default=50, ge=1, le=200),
    view: Optional[str] = Query(default=None, description="Filter: 'phishing', 'email' or 'link'. Omit for all runs."),
) -> list[dict]:
    """Summary list — newest first — for the history sidebar. An optional
    `view` restricts to a subset of case types (see _VIEW_CASE_TYPES)."""
    case_types = _VIEW_CASE_TYPES.get(view) if view else None
    return list_runs(limit=limit, case_types=case_types)


@router.get("/runs/{run_id}", tags=["History"])
async def get_run_detail(run_id: str) -> dict:
    """Full detail for one run — every tool call, screenshot path, verdict."""
    run = get_run(run_id)
    if run is None:
        raise NotFoundError(f"Run {run_id} not found")
    return {**run, "campaign_id": await asyncio.to_thread(campaign_for_run, run_id)}
