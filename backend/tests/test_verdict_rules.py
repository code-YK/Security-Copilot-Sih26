from agent.verdict_rules import apply_forensics, attribute, normalize_label


def _auth(spf="pass", dkim="none", dmarc="pass", policy="reject", spf_aligned=True, dkim_aligned=None):
    return {"available": True, "from_domain": "paypal.com", "spf": {"result": spf}, "dkim": {"result": dkim},
            "dmarc": {"result": dmarc, "policy": policy},
            "alignment": {"spf_aligned": spf_aligned, "dkim_aligned": dkim_aligned}}


def _forensics(auth, age=None, tor=False):
    f = {"validate_email_auth": auth, "geolocate_ip": {"ip": "1.2.3.4", "infrastructure": {"is_tor": tor, "anonymized": tor}}}
    if age is not None:
        f["domain_reputation"] = {"whois": {"available": True, "age_days": age}}
    return f


def test_legacy_labels():
    assert normalize_label("dangerous") == "phishing"
    assert normalize_label("safe") == "legitimate"
    assert normalize_label("weird") == "suspicious"


def test_dmarc_fail_escalates_legitimate_to_impersonated():
    out = apply_forensics({"label": "legitimate", "confidence": 0.8}, _forensics(_auth(spf="fail", dmarc="fail", spf_aligned=False)))
    assert out["label"] == "impersonated"
    assert out["risk_score"] >= 0.7
    assert any("DMARC failed" in f for f in out["risk_factors"])
    assert out["attribution"] == "spoofed_domain"


def test_no_forensics_is_label_only():
    out = apply_forensics({"label": "legitimate", "confidence": 0.9}, None)
    assert out["label"] == "legitimate" and out["risk_factors"] == [] and out["risk_score"] == 0.05
    assert out["attribution"] == "unknown"


def test_attribution_rules():
    assert attribute("phishing", _forensics(_auth(), age=4000))[0] == "compromised_account"
    assert attribute("phishing", _forensics(_auth(), age=3, tor=True))[0] == "anonymized_infrastructure"
    assert attribute("fraud-related", _forensics(_auth(), age=3))[0] == "direct_actor"
    assert attribute("phishing", _forensics(_auth(spf="softfail", dmarc="none", policy=None), tor=True))[0] == "anonymized_infrastructure"
    assert attribute("phishing", _forensics(_auth(spf="softfail", dmarc="none", policy=None)))[0] == "unknown"
    assert attribute("phishing", None)[0] == "unknown"
