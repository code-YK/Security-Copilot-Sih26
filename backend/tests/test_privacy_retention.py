import time

import pytest

from conftest import load_fixture


def test_mask_body_keeps_headers():
    pytest.importorskip("presidio_analyzer")
    from utils.privacy import mask_email_for_storage

    raw = load_fixture("legit_gmail.eml").replace(
        "- Alice", "Call me on +91 98765 43210 or mail alice.personal@example.org. - Alice Sharma"
    )
    masked = mask_email_for_storage(raw)
    head, _, body = masked.partition("\n\n")
    assert "From: Alice <alice@gmail.com>" in head  # evidence untouched
    assert "98765 43210" not in body and "alice.personal@example.org" not in body
    assert "<PHONE_NUMBER>" in body and "<EMAIL_ADDRESS>" in body


def test_retention_purge(tmp_path, monkeypatch):
    from config import get_settings

    monkeypatch.setenv("HISTORY_DB_PATH", str(tmp_path / "h.db"))
    monkeypatch.setenv("RETENTION_DAYS", "1")
    get_settings.cache_clear()
    from history import get_run, purge_expired, record_run

    report = tmp_path / "r.md"
    report.write_text("x")
    run_id = record_run("link", "http://x.test", [], {"label": "legitimate"}, str(report))
    assert purge_expired() == []
    assert purge_expired(now=time.time() + 2 * 86400) == [run_id]
    assert get_run(run_id) is None and not report.exists()
    get_settings.cache_clear()
