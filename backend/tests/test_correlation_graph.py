import json

import numpy as np
import pytest

from tools import correlation_graph as cg


def _run(run_id, label, sender, ip, link):
    return {
        "id": run_id, "case_type": "email", "raw_input": "x", "created_at": 1000.0 + len(run_id),
        "verdict": {"label": label},
        "tool_calls": [
            {"tool": "analyze_email_headers", "args": {}, "artifact": {"available": True, "from": sender, "origin_ip": ip}},
            {"tool": "inspect_website", "args": {"url": link}, "artifact": {"final_url": link, "server_ip": "203.0.113.5"}},
        ],
    }


RUNS = [
    _run("r1", "phishing", "a@evil.test", "185.220.101.34", "http://login.evil.test/x"),
    _run("r2", "phishing", "b@evil.test", "185.220.101.34", "http://pay.other.test/"),
    _run("r3", "legitimate", "c@good.test", "209.85.220.41", "https://good.test/"),
]


@pytest.fixture
def history(monkeypatch, tmp_path):
    from config import get_settings

    monkeypatch.setattr(cg, "list_run_details", lambda: RUNS)
    monkeypatch.setattr(cg, "get_run", lambda rid: next((r for r in RUNS if r["id"] == rid), None))
    mem = tmp_path / "mem"
    mem.mkdir()
    base = np.random.default_rng(0).normal(size=768)
    other = np.random.default_rng(1).normal(size=768)
    np.save(mem / "case_embeddings.npy", np.stack([base, base + 0.01, other]).astype("float32"))
    (mem / "case_metadata.json").write_text(json.dumps([
        {"run_id": r["id"], "case_type": "email", "raw_input": r["raw_input"], "label": r["verdict"]["label"], "reason": ""}
        for r in RUNS
    ]))
    monkeypatch.setenv("CASE_MEMORY_DIR", str(mem))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_entities():
    ents = cg.entities_for_run(RUNS[0])
    assert {("sender", "a@evil.test"), ("domain", "evil.test"), ("ip", "185.220.101.34"),
            ("domain", "login.evil.test"), ("ip", "203.0.113.5")} <= ents


def test_entities_strip_display_names():
    run = {"case_type": "email", "raw_input": "", "tool_calls": [
        {"tool": "analyze_email_headers", "args": {}, "artifact": {
            "available": True,
            "from": "Rajesh Verma (CEO) <Rajesh.Verma@Company-HQ.com>",
            "reply_to": "<ceo.office@gmail.com>",
        }},
    ]}
    ents = cg.entities_for_run(run)
    assert ("sender", "rajesh.verma@company-hq.com") in ents
    assert ("domain", "company-hq.com") in ents
    assert ("sender", "ceo.office@gmail.com") in ents
    assert not any(v.endswith(">") or " " in v for _, v in ents)


def test_graph_links_cases_through_shared_ip(history):
    result = cg.connected_to("185.220.101.34")
    assert result["case_count"] == 2 and result["malicious_case_count"] == 2
    values = {r["value"] for r in result["related"]}
    assert {"a@evil.test", "b@evil.test", "pay.other.test"} <= values

    graph = cg.graph_for_run("r1")
    ids = {n["id"] for n in graph["nodes"]}
    assert "sender:b@evil.test" in ids  # reached through the shared origin IP
    assert any(n["in_case"] for n in graph["nodes"])


def test_campaigns_cluster_similar_malicious_cases(history):
    campaigns = cg.find_campaigns()
    assert len(campaigns) == 1
    c = campaigns[0]
    assert sorted(c["run_ids"]) == ["r1", "r2"]
    assert {"type": "ip", "value": "185.220.101.34"} in c["shared_entities"]
    assert cg.campaign_for_run("r1") == c["campaign_id"]
    assert cg.campaign_for_run("r3") is None
