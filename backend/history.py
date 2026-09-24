"""
Run history — every case the agent has investigated, for the UI's
history list/detail views. Not agent- or LangGraph-specific, same
spirit as report.py: it just stores whatever evidence it's handed.

Deliberately its own SQLite file/table, separate from
cache/sqlite_cache.py's `verdict_cache`: that table is a fast-path
*cache* keyed by URL (one row per URL, overwritten on every recheck —
see spec section 2); this is a full *history log* (every run kept, even
repeat checks of the same URL) — different concerns, different tables.
"""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from config import get_settings

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    case_type TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    created_at REAL NOT NULL,
    verdict_json TEXT NOT NULL,
    tool_calls_json TEXT NOT NULL,
    report_path TEXT,
    retain_until REAL
)
"""


def _connect() -> sqlite3.Connection:
    settings = get_settings()
    db_path = Path(settings.HISTORY_DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute(_SCHEMA)
    # Databases created before the retention column existed.
    if "retain_until" not in {row[1] for row in conn.execute("PRAGMA table_info(runs)")}:
        conn.execute("ALTER TABLE runs ADD COLUMN retain_until REAL")
    return conn


def record_run(
    case_type: str,
    raw_input: str,
    tool_calls: list[dict[str, Any]],
    verdict: Optional[dict],
    report_path: Optional[str] = None,
) -> str:
    """Save a completed case to history. `tool_calls` items are
    {"tool", "args", "artifact", "screenshot_path"} dicts — same shape
    report.py takes, so both are built from the same accumulator. Returns
    the new run's id."""
    run_id = uuid.uuid4().hex
    verdict = verdict or {"label": "inconclusive", "confidence": 0.0, "reason": "No verdict was reached."}

    # The raw screenshot bytes never belong in this table — the file path
    # (already written by utils/screenshots.py) is enough to serve it back.
    trimmed_calls = []
    for call in tool_calls:
        artifact = dict(call.get("artifact") or {})
        artifact.pop("screenshot_base64", None)
        trimmed_calls.append(
            {
                "tool": call["tool"],
                "args": call.get("args") or {},
                "artifact": artifact,
                "screenshot_path": call.get("screenshot_path"),
            }
        )

    now = time.time()
    days = get_settings().RETENTION_DAYS
    retain_until = now + days * 86400 if days > 0 else None
    with _connect() as conn:
        conn.execute(
            "INSERT INTO runs (id, case_type, raw_input, created_at, verdict_json, tool_calls_json, report_path, retain_until) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (run_id, case_type, raw_input, now, json.dumps(verdict), json.dumps(trimmed_calls), report_path, retain_until),
        )
        conn.commit()
    return run_id


def list_runs(limit: int = 50, case_types: Optional[list[str]] = None) -> list[dict]:
    """Summary rows for the history list view — newest first.

    `case_types`, when given, restricts to those case_type values."""
    query = "SELECT id, case_type, raw_input, created_at, verdict_json FROM runs"
    params: list[Any] = []
    if case_types:
        placeholders = ",".join("?" for _ in case_types)
        query += f" WHERE case_type IN ({placeholders})"
        params.extend(case_types)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)

    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()

    return [
        {"id": r[0], "case_type": r[1], "raw_input": r[2], "created_at": r[3], "verdict": json.loads(r[4])}
        for r in rows
    ]


def purge_expired(now: Optional[float] = None) -> list[str]:
    """Delete runs past their retain_until (and their report files). Returns the deleted run ids."""
    now = now or time.time()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, report_path FROM runs WHERE retain_until IS NOT NULL AND retain_until < ?", (now,)
        ).fetchall()
        conn.execute("DELETE FROM runs WHERE retain_until IS NOT NULL AND retain_until < ?", (now,))
        conn.commit()
    for _, report_path in rows:
        if report_path:
            Path(report_path).unlink(missing_ok=True)
    return [r[0] for r in rows]


def list_run_details(limit: int = 2000) -> list[dict]:
    """Every run with its tool calls, newest first — input for tools/correlation_graph.py."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, case_type, raw_input, created_at, verdict_json, tool_calls_json FROM runs "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [
        {"id": r[0], "case_type": r[1], "raw_input": r[2], "created_at": r[3],
         "verdict": json.loads(r[4]), "tool_calls": json.loads(r[5])}
        for r in rows
    ]


def get_run(run_id: str) -> Optional[dict]:
    """Full detail for the history detail view — every tool call, screenshot path included."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, case_type, raw_input, created_at, verdict_json, tool_calls_json, report_path "
            "FROM runs WHERE id = ?",
            (run_id,),
        ).fetchone()

    if row is None:
        return None

    return {
        "id": row[0],
        "case_type": row[1],
        "raw_input": row[2],
        "created_at": row[3],
        "verdict": json.loads(row[4]),
        "tool_calls": json.loads(row[5]),
        "report_path": row[6],
    }
