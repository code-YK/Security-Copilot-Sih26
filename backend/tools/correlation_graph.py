"""
Identity correlation across past cases.

  * Graph (NetworkX, in memory, rebuilt from history.db on demand): nodes
    are domains, IPs and sender addresses; an edge means "seen together in
    a case" and carries the ids of those cases.
  * Campaigns: DBSCAN over the SecureBERT case embeddings memory/case_index.py
    already stores, restricted to malicious verdicts. A campaign is just a
    cluster id shared by a group of cases.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
from itertools import combinations
from pathlib import Path

import networkx as nx
import numpy as np
from langchain_core.tools import tool

from config import get_settings
from history import get_run, list_run_details
from utils.validators import extract_domain, is_ip_address

_BENIGN_LABELS = {"legitimate", "safe"}


def _email_domain(address: str | None) -> str | None:
    return address.rsplit("@", 1)[1].lower() if address and "@" in address else None


def entities_for_run(run: dict) -> set[tuple[str, str]]:
    """(type, value) pairs a run touched — type is 'domain', 'ip' or 'sender'."""
    found: set[tuple[str, str]] = set()

    def add_host(value: str | None) -> None:
        if not value:
            return
        host = extract_domain(value).lower().strip(".")
        if host:
            found.add(("ip" if is_ip_address(host) else "domain", host))

    if run["case_type"] == "link":
        add_host(run["raw_input"])
    for call in run.get("tool_calls") or []:
        tool_name, artifact, args = call.get("tool"), call.get("artifact") or {}, call.get("args") or {}
        if tool_name == "analyze_email_headers" and artifact.get("available"):
            for key in ("from", "reply_to", "return_path"):
                if artifact.get(key):
                    found.add(("sender", artifact[key].lower()))
                    add_host(_email_domain(artifact[key]))
            if artifact.get("origin_ip"):
                found.add(("ip", artifact["origin_ip"]))
        elif tool_name == "inspect_website":
            add_host(args.get("url"))
            add_host(artifact.get("final_url"))
            if artifact.get("server_ip"):
                found.add(("ip", artifact["server_ip"]))
        elif tool_name == "domain_reputation":
            add_host(artifact.get("domain") or args.get("url"))
        elif tool_name == "geolocate_ip" and artifact.get("ip"):
            found.add(("ip", artifact["ip"]))
    return found


def _node_id(kind: str, value: str) -> str:
    return f"{kind}:{value}"


def build_graph(runs: list[dict] | None = None) -> nx.Graph:
    graph = nx.Graph()
    for run in runs if runs is not None else list_run_details():
        label = (run.get("verdict") or {}).get("label")
        entities = sorted(entities_for_run(run))
        ids = [_node_id(k, v) for k, v in entities]
        for (kind, value), node in zip(entities, ids):
            if node not in graph:
                graph.add_node(node, type=kind, value=value, cases=set(), malicious_cases=set())
            graph.nodes[node]["cases"].add(run["id"])
            if label and label not in _BENIGN_LABELS:
                graph.nodes[node]["malicious_cases"].add(run["id"])
        for a, b in combinations(ids, 2):
            if not graph.has_edge(a, b):
                graph.add_edge(a, b, cases=set())
            graph.edges[a, b]["cases"].add(run["id"])
    return graph


def _to_json(graph: nx.Graph, nodes: set[str], focus: set[str]) -> dict:
    return {
        "nodes": [
            {"id": n, "type": graph.nodes[n]["type"], "value": graph.nodes[n]["value"],
             "case_count": len(graph.nodes[n]["cases"]), "malicious_case_count": len(graph.nodes[n]["malicious_cases"]),
             "in_case": n in focus}
            for n in sorted(nodes)
        ],
        "links": [
            {"source": a, "target": b, "case_count": len(graph.edges[a, b]["cases"])}
            for a, b in graph.subgraph(nodes).edges
        ],
    }


def graph_for_run(run_id: str) -> dict | None:
    """The run's own entities plus everything they were seen with in other cases."""
    run = get_run(run_id)
    if run is None:
        return None
    graph = build_graph()
    focus = {_node_id(k, v) for k, v in entities_for_run(run)} & set(graph.nodes)
    nodes = set(focus)
    for node in focus:
        nodes.update(graph.neighbors(node))
    return _to_json(graph, nodes, focus)


def connected_to(entity: str) -> dict:
    """What else has been seen alongside a domain, IP or sender address."""
    entity = entity.strip().lower()
    if "@" not in entity:
        entity = extract_domain(entity).lower()
    graph = build_graph()
    matches = [n for n, d in graph.nodes(data=True) if d["value"] == entity]
    if not matches:
        return {"entity": entity, "seen_before": False, "related": []}
    related = []
    for node in matches:
        for neighbor in graph.neighbors(node):
            data = graph.nodes[neighbor]
            related.append({"type": data["type"], "value": data["value"],
                            "shared_cases": sorted(graph.edges[node, neighbor]["cases"])[:10]})
    related.sort(key=lambda r: -len(r["shared_cases"]))
    cases = set().union(*(graph.nodes[n]["cases"] for n in matches))
    malicious = set().union(*(graph.nodes[n]["malicious_cases"] for n in matches))
    return {"entity": entity, "seen_before": True, "case_count": len(cases),
            "malicious_case_count": len(malicious), "related": related[:25]}


def _load_case_embeddings() -> tuple[np.ndarray, list[dict]]:
    data_dir = Path(get_settings().CASE_MEMORY_DIR)
    emb_path, meta_path = data_dir / "case_embeddings.npy", data_dir / "case_metadata.json"
    if not emb_path.exists() or not meta_path.exists():
        return np.zeros((0, 768), dtype="float32"), []
    return np.load(emb_path), json.loads(meta_path.read_text(encoding="utf-8"))


def find_campaigns() -> list[dict]:
    from sklearn.cluster import DBSCAN

    embeddings, metadata = _load_case_embeddings()
    malicious = [i for i, m in enumerate(metadata) if m.get("label") not in _BENIGN_LABELS]
    if len(malicious) < 2:
        return []
    # Raw SecureBERT vectors all sit at ~0.98 cosine to each other; centering removes that shared direction.
    centered = embeddings - embeddings.mean(axis=0)
    centered /= np.linalg.norm(centered, axis=1, keepdims=True).clip(min=1e-9)
    labels = DBSCAN(eps=get_settings().CAMPAIGN_DBSCAN_EPS, min_samples=2, metric="cosine").fit(centered[malicious]).labels_

    clusters: dict[int, list[dict]] = {}
    for idx, cluster in zip(malicious, labels):
        if cluster >= 0:
            clusters.setdefault(int(cluster), []).append(metadata[idx])

    campaigns = []
    for members in clusters.values():
        run_ids = [m["run_id"] for m in members]
        runs = [r for r in (get_run(rid) for rid in run_ids) if r]
        seen = [r["created_at"] for r in runs]
        entity_counts: dict[tuple[str, str], int] = {}
        for run in runs:
            for entity in entities_for_run(run):
                entity_counts[entity] = entity_counts.get(entity, 0) + 1
        shared = [{"type": k, "value": v} for (k, v), n in sorted(entity_counts.items()) if n >= 2]
        campaigns.append({
            # Stable across recomputes as long as the cluster's first member stays in it.
            "campaign_id": "C-" + hashlib.sha1(sorted(run_ids)[0].encode()).hexdigest()[:8],
            "case_count": len(members),
            "run_ids": run_ids,
            "labels": sorted({m.get("label", "") for m in members}),
            "sample_inputs": [m["raw_input"][:120] for m in members[:3]],
            "shared_entities": shared,
            "first_seen": min(seen) if seen else None,
            "last_seen": max(seen) if seen else None,
        })
    campaigns.sort(key=lambda c: -c["case_count"])
    return campaigns


def campaign_for_run(run_id: str) -> str | None:
    return next((c["campaign_id"] for c in find_campaigns() if run_id in c["run_ids"]), None)


@tool
async def correlate_entity(entity: str) -> dict:
    """Looks up a domain, IP address or sender email address in the history of past investigations and returns what it has been seen alongside (other domains, IPs, sender addresses) and how many of those cases were malicious. Use it to tell whether an origin IP, sender or domain is part of something seen before."""
    try:
        return await asyncio.to_thread(connected_to, entity)
    except Exception as exc:  # noqa: BLE001 — history is a bonus signal
        return {"entity": entity, "available": False, "detail": f"Correlation lookup failed: {exc}"}
