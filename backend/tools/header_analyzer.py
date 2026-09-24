"""
`analyze_email_headers` tool — RFC822 header forensics.

Parses a raw .eml / pasted message with the stdlib `email` package and
reports the sender identity headers, the full `Received:` chain in
chronological order, the probable originating server ("hop-0": the
earliest hop with a public IP), and anomalies worth an analyst's eye.
Pure parsing — no network calls, so it never needs to degrade.
"""
from __future__ import annotations

import ipaddress
import re
from datetime import datetime
from email import message_from_string, policy
from email.message import EmailMessage
from email.utils import getaddresses, parsedate_to_datetime
from html.parser import HTMLParser

from langchain_core.tools import tool

_HEADER_LINE_RE = re.compile(r"^[A-Za-z0-9-]+:\s")
_IPV4_RE = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d{1,3}){3})(?![\d.])")
_IPV6_RE = re.compile(r"\[(?:IPv6:)?([0-9a-fA-F:]+:[0-9a-fA-F:.]+)\]")
_FROM_HOST_RE = re.compile(r"^\s*from\s+(\S+)", re.IGNORECASE)
_BY_HOST_RE = re.compile(r"\bby\s+(\S+)", re.IGNORECASE)
_FROM_CLAUSE_RE = re.compile(r"^\s*from\s+(.*?)(?=\bby\s|\bwith\s|\bid\s|;|$)", re.IGNORECASE | re.DOTALL)

# Receiving servers' clocks drift; only flag reordering beyond this.
_CLOCK_SKEW_SECONDS = 300


def looks_like_rfc822(text: str) -> bool:
    """True if `text` starts with a header block that has at least a From: or Received: header."""
    head = text.lstrip().split("\n\n", 1)[0].replace("\r", "")
    lines = [l for l in head.split("\n") if l and not l[0].isspace()]
    if not lines or not all(_HEADER_LINE_RE.match(l) for l in lines[:3]):
        return False
    names = {l.split(":", 1)[0].lower() for l in lines}
    return bool(names & {"from", "received"})


def parse_message(raw: str) -> EmailMessage:
    return message_from_string(raw, policy=policy.default)


def _domain_of(address: str | None) -> str | None:
    if not address or "@" not in address:
        return None
    return address.rsplit("@", 1)[1].strip(" >").lower() or None


def _first_address(msg: EmailMessage, header: str) -> str | None:
    values = msg.get_all(header) or []
    pairs = getaddresses([str(v) for v in values])
    return pairs[0][1].lower() if pairs and pairs[0][1] else None


def _is_public(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_global
    except ValueError:
        return False


def _parse_received(value: str) -> dict:
    value = " ".join(value.split())
    head, _, date_part = value.rpartition(";")
    if not head:
        head, date_part = value, ""

    timestamp = None
    try:
        timestamp = parsedate_to_datetime(date_part.strip()) if date_part.strip() else None
    except (TypeError, ValueError):
        pass

    from_clause = _FROM_CLAUSE_RE.search(head)
    from_text = from_clause.group(1) if from_clause else ""
    # The IP in the "from" clause is the connecting client — the hop we care about.
    ips = _IPV4_RE.findall(from_text) + _IPV6_RE.findall(from_text)
    valid_ips = [ip for ip in ips if _valid_ip(ip)]
    public = [ip for ip in valid_ips if _is_public(ip)]

    from_host = _FROM_HOST_RE.search(head)
    by_host = _BY_HOST_RE.search(head)
    return {
        "from_host": from_host.group(1).strip("()[]") if from_host else None,
        "by_host": by_host.group(1).strip("()[];") if by_host else None,
        "ip": (public or valid_ips or [None])[0],
        "ip_is_public": bool(public),
        "timestamp": timestamp.isoformat() if timestamp else None,
        "raw": value[:500],
    }


def _valid_ip(ip: str) -> bool:
    try:
        ipaddress.ip_address(ip)
        return True
    except ValueError:
        return False


def analyze_headers(msg: EmailMessage) -> dict:
    from_addr = _first_address(msg, "From")
    return_path = _first_address(msg, "Return-Path")
    reply_to = _first_address(msg, "Reply-To")
    message_id = str(msg.get("Message-ID") or "").strip() or None

    # Received headers are prepended by each server, so reverse for oldest-first.
    hops = [_parse_received(str(v)) for v in reversed(msg.get_all("Received") or [])]
    for i, hop in enumerate(hops):
        hop["index"] = i
        hop["flags"] = []

    flags: list[dict] = []

    def flag(code: str, severity: str, detail: str) -> None:
        flags.append({"code": code, "severity": severity, "detail": detail})

    if not hops:
        flag("no_received_chain", "high", "No Received headers — the delivery path can't be traced, or was stripped.")

    prev: datetime | None = None
    for hop in hops:
        if not hop["timestamp"]:
            hop["flags"].append("missing_timestamp")
            continue
        ts = datetime.fromisoformat(hop["timestamp"])
        if prev is not None and ts.tzinfo and prev.tzinfo and (prev - ts).total_seconds() > _CLOCK_SKEW_SECONDS:
            hop["flags"].append("out_of_order")
        prev = ts
    if any("out_of_order" in h["flags"] for h in hops):
        flag("out_of_order_timestamps", "medium", "Received timestamps go backwards in time — possible forged or injected hops.")
    if hops and all("missing_timestamp" in h["flags"] for h in hops):
        flag("no_hop_timestamps", "medium", "No Received hop carries a parseable timestamp.")

    origin = next((h for h in hops if h["ip_is_public"]), None)
    origin_source = "received_chain" if origin else None
    origin_ip = origin["ip"] if origin else None
    if origin:
        origin["flags"].append("origin")
    # Webmail providers often record the real client IP here instead of in Received.
    x_orig = str(msg.get("X-Originating-IP") or "").strip("[] ")
    if not origin_ip and x_orig and _valid_ip(x_orig) and _is_public(x_orig):
        origin_ip, origin_source = x_orig, "x_originating_ip"
    # SPF is checked against the IP that handed the message to the recipient's MX — the newest public hop.
    delivering = next((h for h in reversed(hops) if h["ip_is_public"]), None)
    if hops and not origin_ip:
        flag("no_public_origin", "low", "No public IP found in the Received chain — origin can't be geolocated.")

    from_domain = _domain_of(from_addr)
    rp_domain = _domain_of(return_path)
    reply_domain = _domain_of(reply_to)
    msgid_domain = _domain_of(message_id.strip("<>")) if message_id else None

    if not from_addr:
        flag("missing_from", "high", "No usable From: address.")
    if from_domain and rp_domain and from_domain != rp_domain:
        flag("from_return_path_mismatch", "medium", f"From domain '{from_domain}' differs from Return-Path domain '{rp_domain}'.")
    if from_domain and reply_domain and from_domain != reply_domain:
        flag("reply_to_mismatch", "high", f"Replies go to '{reply_domain}', not the sender's domain '{from_domain}'.")
    if not message_id:
        flag("missing_message_id", "low", "No Message-ID header — unusual for legitimate mail servers.")
    elif from_domain and msgid_domain and not (msgid_domain == from_domain or msgid_domain.endswith("." + from_domain) or from_domain.endswith("." + msgid_domain)):
        flag("message_id_domain_mismatch", "low", f"Message-ID was generated by '{msgid_domain}', not '{from_domain}'.")

    return {
        "from": from_addr,
        "from_display": str(msg.get("From") or ""),
        "from_domain": from_domain,
        "return_path": return_path,
        "reply_to": reply_to,
        "message_id": message_id,
        "subject": str(msg.get("Subject") or ""),
        "date": str(msg.get("Date") or ""),
        "received_chain": hops,
        "origin_ip": origin_ip,
        "origin_source": origin_source,
        "delivering_ip": delivering["ip"] if delivering else None,
        "flags": flags,
    }


class _TextAndLinks(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.text: list[str] = []
        self.links: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        if tag == "a":
            href = dict(attrs).get("href")
            if href and href.startswith(("http://", "https://")):
                self.links.append(href)

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, data):
        if not self._skip and data.strip():
            self.text.append(data.strip())


def extract_body(msg: EmailMessage) -> tuple[str, list[str]]:
    """Decoded body text (plain preferred, else HTML stripped) plus real <a href> targets from any HTML part."""
    plain, html_text, links = [], [], []
    for part in msg.walk():
        if part.is_multipart() or part.get_content_disposition() == "attachment":
            continue
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            content = part.get_content()
        except (LookupError, ValueError):
            content = (part.get_payload(decode=True) or b"").decode("utf-8", "replace")
        if ctype == "text/plain":
            plain.append(content)
        else:
            parser = _TextAndLinks()
            parser.feed(content)
            html_text.append(" ".join(parser.text))
            links.extend(parser.links)
    body = "\n".join(plain) if plain else "\n".join(html_text)
    return body.strip(), links


@tool
async def analyze_email_headers(raw_email: str) -> dict:
    """Parses a raw email's headers: sender identity (From, Return-Path, Reply-To, Message-ID), the Received delivery chain oldest-first, the probable originating server IP, and anomalies such as sender mismatches or out-of-order hops."""
    if not looks_like_rfc822(raw_email):
        return {"available": False, "detail": "Input has no RFC822 header block — nothing to analyze."}
    return {"available": True, **analyze_headers(parse_message(raw_email))}
