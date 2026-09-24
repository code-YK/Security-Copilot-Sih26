"""GET /campaigns, GET /runs/{run_id}/graph, GET /correlate — identity correlation (tools/correlation_graph.py)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query

from exceptions import NotFoundError
from tools.correlation_graph import connected_to, find_campaigns, graph_for_run

router = APIRouter()


@router.get("/campaigns", tags=["Intel"])
async def get_campaigns() -> list[dict]:
    return await asyncio.to_thread(find_campaigns)


@router.get("/runs/{run_id}/graph", tags=["Intel"])
async def get_run_graph(run_id: str) -> dict:
    graph = await asyncio.to_thread(graph_for_run, run_id)
    if graph is None:
        raise NotFoundError(f"Run {run_id} not found")
    return graph


@router.get("/correlate", tags=["Intel"])
async def correlate(entity: str = Query(..., description="A domain, IP address or sender email address")) -> dict:
    return await asyncio.to_thread(connected_to, entity)
