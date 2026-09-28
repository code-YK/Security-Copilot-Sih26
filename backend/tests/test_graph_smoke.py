"""End-to-end run of the real LangGraph graph with the LLM stubbed out."""
import importlib

import pytest
from langchain_core.messages import AIMessage

from conftest import load_fixture

FINAL = "VERDICT: phishing\nCONFIDENCE: 0.9\nREASON: Spoofed PayPal sender.\nALTERNATIVES: none"


class _FakeLLM:
    def bind_tools(self, tools):
        return self

    def invoke(self, messages):
        _FakeLLM.seen = messages
        return AIMessage(content=FINAL)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    from config import get_settings

    for key, name in [("HISTORY_DB_PATH", "h.db"), ("CACHE_DB_PATH", "c.db"), ("REPORT_DIR", "reports"), ("CASE_MEMORY_DIR", "mem")]:
        monkeypatch.setenv(key, str(tmp_path / name))
    get_settings.cache_clear()
    monkeypatch.setattr("agent.agent_node.get_llm", lambda: _FakeLLM())
    # Keep the suite offline: stub every live DNS/HTTP lookup the forensics tools make.
    monkeypatch.setattr("tools.auth_validator._compute_spf", lambda d, ip: {"result": "none"})
    monkeypatch.setattr("tools.auth_validator._fetch_dmarc", lambda d: {"policy": None, "record": None})
    monkeypatch.setattr("tools.geolocate._mmdb_lookup", lambda ip: {"source": "test", "country": "Germany", "isp": "X"})
    monkeypatch.setattr("tools.geolocate._tor_exits", lambda: {"185.220.101.34"})

    async def _whois(domain):
        return {"available": True, "age_days": 9000, "detail": "old"}

    async def _vt(target):
        return {"available": False}

    # The package re-exports the @tool under the same name, so patch the module object itself.
    reputation_module = importlib.import_module("tools.domain_reputation")
    monkeypatch.setattr(reputation_module, "_lookup_whois", _whois)
    monkeypatch.setattr(reputation_module, "_lookup_virustotal", _vt)
    monkeypatch.setattr(reputation_module, "_lookup_dns", lambda d: {"available": False})
    yield
    get_settings.cache_clear()


async def test_eml_runs_forensics_before_agent():
    from agent.graph import stream_case_traced
    from history import get_run

    events = [e async for e in stream_case_traced("email", load_fixture("phish_paypal.eml"), email_links=[])]
    done = events[-1]
    assert done["type"] == "done"
    # Each forensic check streams its own progress label as it starts, in order.
    labels = [e["label"] for e in events if e["type"] == "progress"]
    forensic = [l for l in labels if any(k in l for k in ("delivery path", "SPF, DKIM", "VirusTotal & domain", "Geolocating", "attachments"))]
    assert forensic[:5] == [
        "Tracing the email's delivery path from its headers...",
        "Checking SPF, DKIM and DMARC...",
        "Checking VirusTotal & domain registration history...",
        "Geolocating the origin IP & checking for VPN/TOR/hosting...",
        "Statically inspecting attachments...",
    ]
    run = get_run(done["run_id"])
    tools = [c["tool"] for c in run["tool_calls"]]
    assert tools[:5] == ["analyze_email_headers", "validate_email_auth", "domain_reputation", "geolocate_ip", "scan_attachments"]
    assert run["tool_calls"][3]["artifact"]["infrastructure"]["is_tor"] is True
    verdict = run["verdict"]
    assert verdict["label"] == "phishing" and verdict["attribution"] == "spoofed_domain"
    assert verdict["risk_score"] == 1.0
    assert run["verdict"]["risk_factors"]
    seed = _FakeLLM.seen[1].content
    assert "185.220.101.34" in seed and "suspended within 24 hours" in seed
    return done


async def test_plain_text_email_skips_forensics():
    from agent.graph import stream_case_traced

    events = [e async for e in stream_case_traced("email", "Hi, click http://x.test now", email_links=["http://x.test"])]
    assert events[-1]["type"] == "done"


def test_api_end_to_end():
    from fastapi.testclient import TestClient

    from api.app import create_app

    client = TestClient(create_app())
    resp = client.post("/check-email", json={"text": load_fixture("phish_paypal.eml")})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["label"] == "phishing" and body["attribution"] == "spoofed_domain"

    detail = client.get(f"/runs/{body['run_id']}").json()
    assert "campaign_id" in detail
    graph = client.get(f"/runs/{body['run_id']}/graph").json()
    assert any(n["value"] == "185.220.101.34" for n in graph["nodes"])
    assert client.get("/campaigns").status_code == 200
    # The link inside the quoted-printable HTML body was decoded and handed to the agent.
    assert "paypal-account-verify.secure-paypa1.com/login?id=8812" in _FakeLLM.seen[1].content
