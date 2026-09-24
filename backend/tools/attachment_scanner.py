"""
`scan_attachments` tool — static inspection of an email's attachments.

Attachments are only ever held in memory as bytes: hashed, sniffed for
their real type (`filetype`, magic bytes) versus the claimed extension,
checked for Office macros (`oletools`, which parses without executing),
and — if a ClamAV daemon is reachable — signature-scanned via `pyclamd`.
Nothing is written to disk, opened, or executed.
"""
from __future__ import annotations

import asyncio
import hashlib
import mimetypes
from functools import lru_cache

from langchain_core.tools import tool

from logger import get_logger
from tools.header_analyzer import looks_like_rfc822, parse_message

logger = get_logger(__name__)

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


@tool
async def scan_attachments(raw_email: str) -> dict:
    """Statically inspects every attachment in a raw email — hashes, real file type versus claimed extension (e.g. invoice.pdf.exe), Office macros, and a ClamAV signature scan when available. Never opens or runs the files."""
    if not looks_like_rfc822(raw_email):
        return {"available": False, "detail": "Input has no RFC822 header block."}
    try:
        return await asyncio.to_thread(scan, raw_email)
    except Exception as exc:  # noqa: BLE001
        logger.warning("scan_attachments failed: %s", exc)
        return {"available": False, "detail": f"Attachment scan failed: {exc}"}
