import io
import zipfile

from conftest import load_fixture
from tools.attachment_scanner import inspect_attachment, scan_attachments


async def test_disguised_executable():
    result = await scan_attachments.ainvoke({"raw_email": load_fixture("phish_paypal.eml")})
    assert result["count"] == 1
    att = result["attachments"][0]
    assert att["filename"] == "invoice.pdf.exe" and att["detected_extension"] == "exe"
    assert len(att["sha256"]) == 64
    codes = {f["code"] for f in att["flags"]}
    assert {"double_extension", "executable", "content_type_mismatch"} <= codes


def test_renamed_exe_is_type_mismatch():
    att = inspect_attachment("report.pdf", "application/pdf", b"MZ\x90\x00" + b"\x00" * 300)
    assert {"type_mismatch", "executable"} <= {f["code"] for f in att["flags"]}


def test_clean_office_zip_without_macros():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<doc/>")
    att = inspect_attachment("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buf.getvalue())
    assert att["flags"] == []


async def test_no_attachments():
    result = await scan_attachments.ainvoke({"raw_email": load_fixture("legit_gmail.eml")})
    assert result["count"] == 0
