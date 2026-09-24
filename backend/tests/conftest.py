import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _no_clamd(monkeypatch):
    # A missing daemon costs a multi-second connect timeout on Windows.
    monkeypatch.setattr("tools.attachment_scanner._clamd", lambda: None)
