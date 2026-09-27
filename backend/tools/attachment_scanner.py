"""
`scan_attachments` tool — static inspection of an email's attachments,
plus a content-level "sandbox" read of document attachments (currently
PDF — the dominant lure format for invoice/ledger-style phishing, exactly
the case that prompted this): parsed with `pypdf` purely as a data
structure (no rendering, no plugin/JS execution engine — Python has none
for PDF JS, so "sandboxed" here means "read the structure and text
without ever executing anything embedded in it", same guarantee the rest
of this file already gives every attachment type).

Attachments are only ever held in memory as bytes: hashed, sniffed for
their real type (`filetype`, magic bytes) versus the claimed extension,
checked for Office macros (`oletools`, which parses without executing),
signature-scanned via ClamAV when reachable, and — for PDFs — parsed for
embedded JavaScript/auto-launch actions/embedded files (all live malware
vectors independent of any macro), plus any URLs found in the text or
link annotations are run through the same corroborated ML+VirusTotal
check the email body's own links get (tools/link_reputation.py), and the
extracted text through the same phishing-language classifier the email
body gets (tools/content_classifier.py) — an attachment's content is
just as capable of carrying a phishing pretext as the email body itself.
Nothing is written to disk, opened, or executed.
"""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import re
from functools import lru_cache

from langchain_core.tools import tool

from logger import get_logger
from tools.header_analyzer import looks_like_rfc822, parse_message
from utils.validators import extract_urls_from_text

logger = get_logger(__name__)

_MAX_PDF_LINKS = 3
_MAX_PDF_TEXT_CHARS = 5000

_EXECUTABLE_EXTS = {
    "exe", "scr", "com", "pif", "bat", "cmd", "js", "jse", "vbs", "vbe", "wsf", "hta", "jar",
    "ps1", "msi", "lnk", "dll", "cpl", "iso", "img",
}
_DOCUMENT_EXTS = {"pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "jpg", "jpeg", "png", "zip"}
_OFFICE_EXTS = {"doc", "docx", "docm", "xls", "xlsx", "xlsm", "ppt", "pptx", "pptm", "dot", "dotm", "xlsb"}
# filetype reports modern Office files as their container format.
_COMPATIBLE = {
    "docx": {"zip"}, "xlsx": {"zip"}, "pptx": {"zip"}, "docm": {"zip"}, "xlsm": {"zip"}, "pptm": {"zip"},
    "doc": {"ole", "cfb"}, "xls": {"ole", "cfb"}, "ppt": {"ole", "cfb"}, "msg": {"ole", "cfb"},
    "jpeg": {"jpg"}, "jpg": {"jpg"}, "tif": {"tif"}, "tiff": {"tif"}, "htm": {"html"},
}


def _extensions(filename: str) -> list[str]:
    parts = filename.lower().rsplit("/", 1)[-1].split(".")
    return parts[1:] if len(parts) > 1 else []


def _pdf_extract(data: bytes) -> dict:
    """Structural-only read: text, link-annotation URIs, and three live
    malware vectors PDFs support independent of macros — embedded
    JavaScript, auto-launch actions, and embedded files. The regex
    fallback for each (searching the raw bytes for the PDF object key)
    catches cases pypdf's object graph can't reach — a deliberately
    malformed or obfuscated PDF is itself a stronger signal, not a reason
    to report nothing."""
    import pypdf

    try:
        reader = pypdf.PdfReader(__import__("io").BytesIO(data))
    except Exception as exc:  # noqa: BLE001 — not a valid/parseable PDF
        return {"available": False, "detail": f"Could not parse as PDF: {exc}"}

    text_parts: list[str] = []
    link_uris: list[str] = []
    for page in reader.pages:
        try:
            text_parts.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001 — a malformed page shouldn't kill the whole scan
            pass
        for annot in page.get("/Annots") or []:
            try:
                obj = annot.get_object()
                uri = (obj.get("/A") or {}).get("/URI")
                if uri:
                    link_uris.append(str(uri))
            except Exception:  # noqa: BLE001
                pass

    text = "\n".join(text_parts).strip()
    link_uris.extend(extract_urls_from_text(text))
    links = list(dict.fromkeys(link_uris))[:_MAX_PDF_LINKS]

    has_js = b"/JavaScript" in data or b"/JS " in data or b"/JS(" in data or bool(re.search(rb"/JS\s*[<(]", data))
    has_launch = b"/Launch" in data
    has_embedded_files = b"/EmbeddedFile" in data

    return {
        "available": True,
        "page_count": len(reader.pages),
        "text_excerpt": text[:_MAX_PDF_TEXT_CHARS],
        "text_truncated": len(text) > _MAX_PDF_TEXT_CHARS,
        "links": links,
        "has_javascript": has_js,
        "has_launch_action": has_launch,
        "has_embedded_files": has_embedded_files,
    }


def _macro_scan(filename: str, data: bytes) -> dict | None:
    from oletools.olevba import VBA_Parser

    try:
        parser = VBA_Parser(filename, data=data)
        try:
            if not parser.detect_vba_macros():
                return {"has_macros": False}
            keywords = [
                {"type": kw_type, "keyword": keyword}
                for kw_type, keyword, _desc in parser.analyze_macros()
                if kw_type in ("AutoExec", "Suspicious", "IOC")
            ][:15]
            return {"has_macros": True, "autoexec": any(k["type"] == "AutoExec" for k in keywords), "indicators": keywords}
        finally:
            parser.close()
    except Exception as exc:  # noqa: BLE001 — not an OLE/OOXML file, or a malformed one
        logger.info("oletools could not parse %s: %s", filename, exc)
        return None


@lru_cache(maxsize=1)
def _clamd():
    """Probed once per process — an absent daemon costs a slow connect timeout on every try."""
    try:
        import pyclamd

        daemon = pyclamd.ClamdNetworkSocket(timeout=2)
        daemon.ping()
        return daemon
    except Exception as exc:  # noqa: BLE001 — ClamAV is optional
        logger.info("ClamAV daemon not reachable, attachment signature scans disabled: %s", exc)
        return None


def _clamav_scan(data: bytes) -> dict:
    daemon = _clamd()
    if daemon is None:
        return {"available": False, "detail": "ClamAV daemon not running on 127.0.0.1:3310"}
    try:
        hit = daemon.scan_stream(data)
    except Exception as exc:  # noqa: BLE001
        return {"available": False, "detail": f"ClamAV scan failed: {exc}"}
    if not hit:
        return {"available": True, "infected": False}
    status, signature = next(iter(hit.values()))
    return {"available": True, "infected": status == "FOUND", "signature": signature}


def inspect_attachment(filename: str, declared_type: str, data: bytes) -> dict:
    import filetype

    exts = _extensions(filename)
    claimed = exts[-1] if exts else None
    guess = filetype.guess(data)
    detected_ext, detected_mime = (guess.extension, guess.mime) if guess else (None, None)

    flags: list[dict] = []

    def flag(code: str, severity: str, detail: str) -> None:
        flags.append({"code": code, "severity": severity, "detail": detail})

    if len(exts) >= 2 and exts[-1] in _EXECUTABLE_EXTS and exts[-2] in _DOCUMENT_EXTS:
        flag("double_extension", "high", f"'{filename}' disguises a .{exts[-1]} file as a .{exts[-2]}.")
    if claimed in _EXECUTABLE_EXTS or detected_ext == "exe":
        flag("executable", "high", f"'{filename}' is an executable file type.")
    if detected_ext and claimed and detected_ext != claimed and detected_ext not in _COMPATIBLE.get(claimed, set()):
        flag("type_mismatch", "high", f"'{filename}' claims to be .{claimed} but its content is .{detected_ext}.")
    declared_exts = {e.lstrip(".") for e in mimetypes.guess_all_extensions(declared_type or "")}
    if detected_ext and declared_exts and detected_ext not in declared_exts \
            and not any(detected_ext in _COMPATIBLE.get(e, set()) for e in declared_exts):
        flag("content_type_mismatch", "medium", f"Declared as {declared_type}, content is {detected_mime}.")

    macros = None
    if claimed in _OFFICE_EXTS or detected_ext in ("zip", "ole", "cfb"):
        macros = _macro_scan(filename, data)
        if macros and macros.get("has_macros"):
            flag("office_macros", "high" if macros.get("autoexec") else "medium",
                 f"'{filename}' contains VBA macros" + (" that run automatically on open." if macros.get("autoexec") else "."))

    clamav = _clamav_scan(data)
    if clamav.get("infected"):
        flag("clamav_detection", "critical", f"ClamAV signature match: {clamav.get('signature')}")

    pdf = None
    if claimed == "pdf" or detected_ext == "pdf":
        pdf = _pdf_extract(data)
        if pdf.get("available"):
            if pdf.get("has_javascript"):
                flag("pdf_embedded_javascript", "critical", f"'{filename}' contains embedded JavaScript — PDFs execute this automatically on open in Adobe Reader and some browser viewers.")
            if pdf.get("has_launch_action"):
                flag("pdf_launch_action", "critical", f"'{filename}' contains a /Launch action that can run an external program or file on open.")
            if pdf.get("has_embedded_files"):
                flag("pdf_embedded_files", "high", f"'{filename}' has one or more files embedded inside it, invisible until extracted.")

    return {
        "filename": filename,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "md5": hashlib.md5(data).hexdigest(),  # noqa: S324 — identifier for threat-intel lookups, not security
        "declared_type": declared_type,
        "claimed_extension": claimed,
        "detected_extension": detected_ext,
        "detected_mime": detected_mime,
        "macros": macros,
        "clamav": clamav,
        "pdf": pdf,
        "flags": flags,
    }


def scan(raw_email: str) -> dict:
    msg = parse_message(raw_email)
    results = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        filename = part.get_filename()
        if not filename and part.get_content_disposition() != "attachment":
            continue
        data = part.get_payload(decode=True) or b""
        results.append(inspect_attachment(filename or "unnamed", part.get_content_type(), data))
    return {
        "available": True,
        "count": len(results),
        "attachments": results,
        "flags": [f for a in results for f in a["flags"]],
    }


async def _evaluate_pdf_content(attachment: dict) -> None:
    """Runs the network/model-dependent checks a PDF's extracted content
    enables — same corroborated link check the email body's own links
    get, same phishing-language classifier the email body's text gets —
    and appends flags/records the scores directly on `attachment` and its
    `pdf` sub-dict. Mutates in place so the caller can just gather() a
    list of these against every attachment in parallel."""
    pdf = attachment.get("pdf")
    if not pdf or not pdf.get("available"):
        return
    filename = attachment["filename"]

    from tools.content_classifier import _score_text
    from tools.link_reputation import evaluate_url

    if pdf.get("links"):
        link_results = await asyncio.gather(*(evaluate_url(u) for u in pdf["links"]), return_exceptions=True)
        evaluated = []
        for url, result in zip(pdf["links"], link_results):
            if isinstance(result, Exception):
                continue
            evaluated.append({"url": url, **result})
            if result["label"] == "dangerous":
                attachment["flags"].append({"code": "attachment_link_dangerous", "severity": "critical", "detail": f"'{filename}' links to {result['domain']}, rated dangerous."})
            elif result["label"] == "suspicious":
                attachment["flags"].append({"code": "attachment_link_suspicious", "severity": "medium", "detail": f"'{filename}' links to {result['domain']}, rated suspicious."})
        pdf["link_verdicts"] = evaluated

    text = pdf.get("text_excerpt")
    if text and text.strip():
        try:
            text_result = await asyncio.to_thread(_score_text, text)
        except Exception as exc:  # noqa: BLE001 — a model hiccup shouldn't drop the rest of the scan
            logger.warning("attachment text classification failed for %s: %s", filename, exc)
        else:
            pdf["text_classification"] = text_result
            if text_result.get("phishing_score", 0.0) >= 0.7:
                attachment["flags"].append({"code": "attachment_text_suspicious", "severity": "high", "detail": f"'{filename}''s text reads as phishing-style content ({text_result['phishing_score']:.0%})."})


@tool
async def scan_attachments(raw_email: str) -> dict:
    """Inspects every attachment in a raw email — hashes, real file type versus claimed extension (e.g. invoice.pdf.exe), Office macros, a ClamAV signature scan when available, and for PDFs: embedded JavaScript/auto-launch/embedded-file detection plus a reputation check on any links and phishing-language check on the extracted text. Never opens, renders, or runs the files."""
    if not looks_like_rfc822(raw_email):
        return {"available": False, "detail": "Input has no RFC822 header block."}
    try:
        result = await asyncio.to_thread(scan, raw_email)
        await asyncio.gather(*(_evaluate_pdf_content(a) for a in result["attachments"]))
        result["flags"] = [f for a in result["attachments"] for f in a["flags"]]
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("scan_attachments failed: %s", exc)
        return {"available": False, "detail": f"Attachment scan failed: {exc}"}
