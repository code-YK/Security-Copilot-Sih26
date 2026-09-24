from conftest import load_fixture
from tools import auth_validator
from tools.auth_validator import spf_eval, validate_email_auth

PARSED = {
    "mechanisms": [
        {"mechanism": "ip4", "action": "pass", "value": "10.1.0.0/16"},
        {"mechanism": "include", "action": "pass", "value": "spf.vendor.test",
         "parsed": {"mechanisms": [{"mechanism": "ip4", "action": "pass", "value": "203.0.113.0/24"}], "all": "fail"}},
    ],
    "all": "softfail",
}


def test_spf_eval():
    assert spf_eval(PARSED, "10.1.2.3", "x.test", [0]) == "pass"
    assert spf_eval(PARSED, "203.0.113.9", "x.test", [0]) == "pass"
    assert spf_eval(PARSED, "198.51.100.1", "x.test", [0]) == "softfail"


async def test_phish_auth_uses_reported_results(monkeypatch):
    monkeypatch.setattr(auth_validator, "_compute_spf", lambda d, ip: {"result": "none"})
    monkeypatch.setattr(auth_validator, "_fetch_dmarc", lambda d: {"policy": "reject", "record": "v=DMARC1; p=reject"})
    result = await validate_email_auth.ainvoke({"raw_email": load_fixture("phish_paypal.eml")})
    assert result["spf"]["result"] == "fail" and result["spf"]["computed"] == "none"
    assert result["dkim"]["result"] == "none"
    assert result["dmarc"]["result"] == "fail"
    assert result["alignment"]["spf_aligned"] is False


async def test_computed_dmarc_when_no_reported_header(monkeypatch):
    monkeypatch.setattr(auth_validator, "_compute_spf", lambda d, ip: {"result": "pass"})
    monkeypatch.setattr(auth_validator, "_fetch_dmarc", lambda d: {"policy": "none", "record": "v=DMARC1; p=none"})
    result = await validate_email_auth.ainvoke({"raw_email": load_fixture("legit_gmail.eml")})
    assert result["spf"]["ip"] == "209.85.220.41"
    assert result["dmarc"]["result"] == "pass"
