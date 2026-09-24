from conftest import load_fixture
from tools.header_analyzer import analyze_email_headers, extract_body, looks_like_rfc822, parse_message


async def test_phish_headers():
    result = await analyze_email_headers.ainvoke({"raw_email": load_fixture("phish_paypal.eml")})
    assert result["available"]
    assert result["from_domain"] == "paypal.com"
    assert result["origin_ip"] == "185.220.101.34"
    chain = result["received_chain"]
    assert [h["index"] for h in chain] == [0, 1, 2]
    assert chain[0]["by_host"] == "mail-relay.secure-paypa1.com"
    assert "out_of_order" in chain[1]["flags"]
    codes = {f["code"] for f in result["flags"]}
    assert {"from_return_path_mismatch", "reply_to_mismatch", "out_of_order_timestamps", "message_id_domain_mismatch"} <= codes


async def test_legit_headers():
    result = await analyze_email_headers.ainvoke({"raw_email": load_fixture("legit_gmail.eml")})
    assert result["origin_ip"] == "209.85.220.41"
    assert result["flags"] == []


def test_detection_and_body():
    raw = load_fixture("phish_paypal.eml")
    assert looks_like_rfc822(raw)
    assert not looks_like_rfc822("Hi team, please click http://x.com now")
    body, links = extract_body(parse_message(raw))
    assert "suspended within 24 hours" in body
    assert links == ["http://paypal-account-verify.secure-paypa1.com/login?id=8812"]


async def test_non_email_input():
    result = await analyze_email_headers.ainvoke({"raw_email": "just some text"})
    assert result["available"] is False
