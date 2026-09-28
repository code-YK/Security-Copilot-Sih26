"""
Demo seed for SIH26106 — AI-Powered Email Threat Detection, GeoLocation
and Forensic Intelligence.

Populates history.db with a curated set of realistic *email* forensic
cases (across all five SIH classes) plus a few link cases, with full
tool-call artifacts — header analysis, SPF/DKIM/DMARC, IP geolocation,
attribution, attachments, VirusTotal — so the dashboard is populated and
demo-ready with zero live LLM/network calls.

It also synthesises the SecureBERT case-memory files (case_embeddings.npy
+ case_metadata.json) so DBSCAN groups the malicious cases into named
campaigns, and shares origin IPs / senders across cases so the
correlation graph links them.

Run:  python seed_demo.py          (wipes existing runs + case memory, reseeds)
      python seed_demo.py --keep   (append without wiping)

Nothing here touches the live agent — list_runs / find_campaigns /
graph_for_run all read fresh from disk, so a running backend reflects the
seed immediately, no restart required.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import time
import uuid
from pathlib import Path

import numpy as np

BASE = Path(__file__).resolve().parent
DB_PATH = BASE / "data" / "history.db"
CASE_MEMORY_DIR = BASE / "data" / "case_memory"

HOUR = 3600
DAY = 86400
NOW = time.time()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    case_type TEXT NOT NULL,
    raw_input TEXT NOT NULL,
    created_at REAL NOT NULL,
    verdict_json TEXT NOT NULL,
    tool_calls_json TEXT NOT NULL,
    report_path TEXT,
    retain_until REAL
)
"""


# ── artifact builders ──────────────────────────────────────────────────
def sha256(seed: str) -> str:
    return hashlib.sha256(seed.encode()).hexdigest()


def headers_call(*, frm, from_domain, return_path, reply_to, subject, origin_ip, chain, flags):
    return {
        "tool": "analyze_email_headers",
        "args": {},
        "artifact": {
            "available": True,
            "from": frm,
            "from_domain": from_domain,
            "return_path": return_path,
            "reply_to": reply_to,
            "message_id": f"<{uuid.uuid4().hex}@{from_domain}>",
            "subject": subject,
            "received_chain": chain,
            "origin_ip": origin_ip,
            "flags": flags,
        },
        "screenshot_path": None,
    }


def auth_call(*, from_domain, spf, dkim, dmarc, dmarc_policy, spf_aligned, dkim_aligned):
    def chk(result, domain=None, policy=None):
        c = {"result": result, "computed": result, "reported": result, "domain": domain}
        if policy:
            c["policy"] = policy
        return c

    return {
        "tool": "validate_email_auth",
        "args": {},
        "artifact": {
            "available": True,
            "from_domain": from_domain,
            "spf": chk(spf, from_domain),
            "dkim": chk(dkim, from_domain),
            "dmarc": chk(dmarc, from_domain, dmarc_policy),
            "alignment": {"spf_aligned": spf_aligned, "dkim_aligned": dkim_aligned},
        },
        "screenshot_path": None,
    }


def geo_call(*, ip, country, cc, region, city, lat, lon, isp, org, asn,
             tor=False, vpn=False, proxy=False, hosting=False, abuse=0, reports=0):
    return {
        "tool": "geolocate_ip",
        "args": {"ip": ip},
        "artifact": {
            "ip": ip,
            "available": True,
            "location": {
                "country": country, "country_code": cc, "region": region, "city": city,
                "lat": lat, "lon": lon, "isp": isp, "org": org, "asn": asn, "source": "maxmind",
            },
            "infrastructure": {
                "is_tor": tor, "is_vpn": vpn, "is_proxy": proxy, "is_hosting": hosting,
                "anonymized": bool(tor or vpn or proxy),
            },
            "reputation": {"available": True, "abuse_confidence_score": abuse, "total_reports": reports},
        },
        "screenshot_path": None,
    }


def attach_call(attachments):
    return {
        "tool": "scan_attachments",
        "args": {},
        "artifact": {"available": True, "count": len(attachments), "attachments": attachments},
        "screenshot_path": None,
    }


def attachment(*, filename, size, mime, claimed, flags):
    return {
        "filename": filename, "size": size, "sha256": sha256(filename + str(size)),
        "detected_mime": mime, "claimed_extension": claimed, "flags": flags,
    }


def domrep_call(*, domain, age_days, malicious, suspicious, harmless, vendors):
    return {
        "tool": "domain_reputation",
        "args": {"url": f"http://{domain}"},
        "artifact": {
            "domain": domain,
            "whois": {"available": True, "age_days": age_days, "is_parent_domain_match": False},
            "virustotal": {
                "available": True,
                "malicious_count": malicious,
                "suspicious_count": suspicious,
                "harmless_count": harmless,
                "reputation_score": -malicious * 3,
                "flagged_by": [{"vendor": v, "category": "phishing", "result": "phishing"} for v in vendors],
                "categories": {v: "phishing" for v in vendors},
                "community_reputation": -malicious,
            },
        },
        "screenshot_path": None,
    }


def hop(index, from_host, by_host, ip, ts, flags, public=True):
    return {"index": index, "from_host": from_host, "by_host": by_host, "ip": ip,
            "ip_is_public": public, "timestamp": ts, "flags": flags}


def raw_email(*, subject, frm, to, return_path, reply_to, date, origin_ip, relay, body):
    return (
        f"Return-Path: <{return_path}>\n"
        f"Received: from {relay} ([{origin_ip}])\n"
        f"\tby mx.recipient.org with ESMTP id {uuid.uuid4().hex[:12]}; {date}\n"
        f"Message-ID: <{uuid.uuid4().hex}@{frm.split('@')[-1]}>\n"
        f"Date: {date}\n"
        f"From: {frm}\n"
        f"Reply-To: {reply_to}\n"
        f"To: {to}\n"
        f"Subject: {subject}\n"
        f"MIME-Version: 1.0\n"
        f"Content-Type: text/plain; charset=UTF-8\n\n"
        f"{body}\n"
    )


# ── the curated demo cases ─────────────────────────────────────────────
# Each: label, risk_score (0-1), attribution, when (seconds ago), campaign
# group (shared embedding cluster + shared origin IP), and the raw email +
# forensic artifacts.
def build_cases() -> list[dict]:
    cases: list[dict] = []

    def add(case):
        cases.append(case)

    # ---- Campaign A: "SBI credential-harvest" (2 cases, shared origin IP) ----
    sbi_ip = "45.142.212.61"
    sbi_geo = dict(ip=sbi_ip, country="Russia", cc="RU", region="Moscow", city="Moscow",
                   lat=55.7558, lon=37.6173, isp="Selectel", org="Selectel Hosting",
                   asn="AS49505", hosting=True, abuse=94, reports=310)
    add({
        "case_type": "email", "when": 0.6 * HOUR, "group": "sbi",
        "label": "phishing", "risk": 0.94, "attribution": "spoofed_domain",
        "attribution_reason": "SPF, DKIM and DMARC all fail; the sending IP is unrelated hosting infrastructure in Russia impersonating an Indian bank's domain.",
        "risk_factors": ["SPF fail", "DKIM fail", "DMARC fail (p=reject)", "credential form link", "brand impersonation"],
        "subject": "URGENT: Your SBI account will be suspended — verify KYC now",
        "frm": "SBI Alerts <alert@sbi-kyc-verify.com>",
        "from_domain": "sbi-kyc-verify.com",
        "return_path": "bounce@sbi-kyc-verify.com", "reply_to": "security@sbi-kyc-verify.com",
        "origin_ip": sbi_ip, "relay": "mail.sbi-kyc-verify.com",
        "body": "Dear Customer, your SBI Net Banking will be suspended within 24 hours due to incomplete KYC. "
                "Verify immediately: http://sbi-kyc-verify.com/login to avoid permanent deactivation.",
        "reason": "This email impersonates State Bank of India and was sent from unrelated hosting infrastructure in Russia. "
                  "SPF, DKIM and DMARC all fail, the sender domain was registered 6 days ago, and the body links to a credential-harvesting page.",
        "auth": dict(spf="fail", dkim="fail", dmarc="fail", dmarc_policy="reject", spf_aligned=False, dkim_aligned=False),
        "geo": sbi_geo,
        "hdr_flags": [{"code": "return_path_mismatch", "severity": "high", "detail": "Return-Path domain does not match From domain."},
                      {"code": "spf_fail", "severity": "high", "detail": "Sending IP is not authorised by the From domain's SPF record."}],
        "domrep": dict(domain="sbi-kyc-verify.com", age_days=6, malicious=11, suspicious=3, harmless=40,
                       vendors=["Kaspersky", "Fortinet", "BitDefender"]),
    })
    add({
        "case_type": "email", "when": 5 * HOUR, "group": "sbi",
        "label": "phishing", "risk": 0.91, "attribution": "spoofed_domain",
        "attribution_reason": "Same hosting infrastructure and lookalike-domain pattern as an earlier State Bank of India phishing case.",
        "risk_factors": ["SPF fail", "DMARC fail", "reused origin IP", "brand impersonation"],
        "subject": "State Bank of India: Debit card blocked — reactivate immediately",
        "frm": "SBI Card <no-reply@sbi-secure-login.com>",
        "from_domain": "sbi-secure-login.com",
        "return_path": "bounce@sbi-secure-login.com", "reply_to": "help@sbi-secure-login.com",
        "origin_ip": sbi_ip, "relay": "smtp.sbi-secure-login.com",
        "body": "Your SBI debit card has been temporarily blocked. Reactivate here: http://sbi-secure-login.com/unlock within 12 hours.",
        "reason": "A second State Bank of India impersonation from the same Russian hosting IP as a prior case — a lookalike domain, "
                  "failing SPF/DMARC, and the same reactivate-your-card credential lure. Part of a coordinated campaign.",
        "auth": dict(spf="fail", dkim="none", dmarc="fail", dmarc_policy="reject", spf_aligned=False, dkim_aligned=None),
        "geo": sbi_geo,
        "hdr_flags": [{"code": "spf_fail", "severity": "high", "detail": "SPF fail — sending IP not authorised."},
                      {"code": "reused_infrastructure", "severity": "medium", "detail": "Origin IP seen in a prior malicious case."}],
        "domrep": dict(domain="sbi-secure-login.com", age_days=4, malicious=8, suspicious=2, harmless=44, vendors=["Fortinet", "Sophos"]),
    })

    # ---- Campaign B: CEO/BEC wire-fraud (2 cases, shared sender + IP) ----
    bec_ip = "197.210.85.44"
    bec_geo = dict(ip=bec_ip, country="Nigeria", cc="NG", region="Lagos", city="Lagos",
                   lat=6.5244, lon=3.3792, isp="MTN Nigeria", org="MTN NG", asn="AS29465",
                   abuse=61, reports=48)
    add({
        "case_type": "email", "when": 1.5 * HOUR, "group": "bec",
        "label": "fraud-related", "risk": 0.88, "attribution": "compromised_account",
        "attribution_reason": "Display name matches a real executive, but Reply-To points to a free webmail address and the origin IP is a mobile carrier in Lagos — a classic business email compromise.",
        "risk_factors": ["executive impersonation", "Reply-To mismatch", "urgent wire request", "free webmail reply-to"],
        "subject": "Re: Urgent wire transfer — confidential",
        "frm": "Rajesh Verma (CEO) <rajesh.verma@company-hq.com>",
        "from_domain": "company-hq.com",
        "return_path": "rajesh.verma@company-hq.com", "reply_to": "rajesh.verma.ceo@gmail.com",
        "origin_ip": bec_ip, "relay": "mail-lagos-01.mtnbusiness.ng",
        "body": "Hi, I'm in a confidential acquisition meeting and can't take calls. I need you to process an urgent wire "
                "of INR 48,50,000 to a new vendor today. Reply here and I'll send the account details. Keep this between us.",
        "reason": "A business email compromise: the display name impersonates the CEO, but Reply-To is a free Gmail address and the "
                  "message originated from a mobile carrier IP in Lagos. The urgency, secrecy and payment-diversion request are textbook BEC.",
        "auth": dict(spf="softfail", dkim="none", dmarc="fail", dmarc_policy="none", spf_aligned=False, dkim_aligned=None),
        "geo": bec_geo,
        "hdr_flags": [{"code": "reply_to_mismatch", "severity": "high", "detail": "Reply-To uses a free webmail address, not the From domain."},
                      {"code": "display_name_spoof", "severity": "medium", "detail": "Display name claims an executive identity."}],
        "domrep": None,
    })
    add({
        "case_type": "email", "when": 26 * HOUR, "group": "bec",
        "label": "fraud-related", "risk": 0.83, "attribution": "compromised_account",
        "attribution_reason": "Same Lagos origin and payment-diversion pattern as a prior CEO-impersonation case.",
        "risk_factors": ["fake invoice", "vendor bank change", "urgency", "reused origin IP"],
        "subject": "Updated bank details for invoice #INV-20871",
        "frm": "Accounts Payable <finance@company-hq.com>",
        "from_domain": "company-hq.com",
        "return_path": "finance@company-hq.com", "reply_to": "finance.company.hq@gmail.com",
        "origin_ip": bec_ip, "relay": "mail-lagos-02.mtnbusiness.ng",
        "body": "Please note our bank details have changed. Kindly remit the outstanding INV-20871 to the new account "
                "effective immediately. Confirm once done.",
        "reason": "A follow-on invoice-fraud message from the same Lagos infrastructure — a vendor bank-change request designed to "
                  "divert a legitimate payment. Correlates with an earlier CEO-impersonation case from the same origin.",
        "auth": dict(spf="softfail", dkim="none", dmarc="fail", dmarc_policy="none", spf_aligned=False, dkim_aligned=None),
        "geo": bec_geo,
        "hdr_flags": [{"code": "reply_to_mismatch", "severity": "high", "detail": "Reply-To uses a free webmail address."},
                      {"code": "reused_infrastructure", "severity": "medium", "detail": "Origin IP seen in a prior malicious case."}],
        "domrep": None,
    })

    # ---- Campaign C: Microsoft/Google credential phishing (2 cases) ----
    cred_ip = "185.220.101.47"
    cred_geo = dict(ip=cred_ip, country="Germany", cc="DE", region="Hesse", city="Frankfurt",
                    lat=50.1109, lon=8.6821, isp="TOR exit", org="Tor Network", asn="AS205100",
                    tor=True, abuse=100, reports=920)
    add({
        "case_type": "email", "when": 3 * HOUR, "group": "cred",
        "label": "impersonated", "risk": 0.86, "attribution": "anonymized_infrastructure",
        "attribution_reason": "Message relayed through a known TOR exit node, deliberately anonymising the true origin; the sender domain is a Microsoft look-alike.",
        "risk_factors": ["lookalike domain (rn->m)", "TOR exit origin", "DMARC fail", "credential form"],
        "subject": "Microsoft 365: unusual sign-in detected — verify your identity",
        "frm": "Microsoft account team <security@rnicrosoft-support.com>",
        "from_domain": "rnicrosoft-support.com",
        "return_path": "bounce@rnicrosoft-support.com", "reply_to": "security@rnicrosoft-support.com",
        "origin_ip": cred_ip, "relay": "anon-relay.exit.torproject.net",
        "body": "We detected an unusual sign-in to your Microsoft 365 account from a new device. If this wasn't you, "
                "verify your identity now: http://rnicrosoft-support.com/verify or your account will be locked.",
        "reason": "A Microsoft look-alike domain (rn-icrosoft) relayed through a TOR exit node to hide its origin. DMARC fails and "
                  "the link leads to a credential-verification page — impersonation designed to harvest Microsoft 365 logins.",
        "auth": dict(spf="fail", dkim="fail", dmarc="fail", dmarc_policy="reject", spf_aligned=False, dkim_aligned=False),
        "geo": cred_geo,
        "hdr_flags": [{"code": "homoglyph_domain", "severity": "high", "detail": "Sender domain uses 'rn' to imitate 'm' (rnicrosoft ≈ microsoft)."},
                      {"code": "tor_origin", "severity": "high", "detail": "Originating IP is a known TOR exit node."}],
        "domrep": dict(domain="rnicrosoft-support.com", age_days=2, malicious=14, suspicious=4, harmless=36,
                       vendors=["Google Safebrowsing", "Kaspersky", "ESET", "Fortinet"]),
    })
    add({
        "case_type": "email", "when": 9 * HOUR, "group": "cred",
        "label": "phishing", "risk": 0.9, "attribution": "anonymized_infrastructure",
        "attribution_reason": "Same anonymised (TOR) relay pattern and credential-verification lure as a prior brand-impersonation case.",
        "risk_factors": ["Google impersonation", "TOR exit origin", "DKIM fail", "obfuscated URL"],
        "subject": "Security alert: your Google Account password was changed",
        "frm": "Google <no-reply@google-account-security.com>",
        "from_domain": "google-account-security.com",
        "return_path": "bounce@google-account-security.com", "reply_to": "no-reply@google-account-security.com",
        "origin_ip": cred_ip, "relay": "anon-relay2.exit.torproject.net",
        "body": "Your Google Account password was just changed. If you didn't do this, secure your account immediately: "
                "http://google-account-security.com/reset?id=8f2a1c .",
        "reason": "A Google impersonation relayed through the same TOR exit infrastructure as a prior Microsoft look-alike case. "
                  "Failing authentication and an obfuscated reset link point to credential theft — part of the same anonymised campaign.",
        "auth": dict(spf="fail", dkim="fail", dmarc="fail", dmarc_policy="quarantine", spf_aligned=False, dkim_aligned=False),
        "geo": cred_geo,
        "hdr_flags": [{"code": "tor_origin", "severity": "high", "detail": "Originating IP is a known TOR exit node."},
                      {"code": "dmarc_fail", "severity": "high", "detail": "DMARC evaluation failed (p=quarantine)."}],
        "domrep": dict(domain="google-account-security.com", age_days=3, malicious=12, suspicious=5, harmless=38,
                       vendors=["Google Safebrowsing", "Sophos", "BitDefender"]),
    })

    # ---- Standalone: fake-invoice with malicious macro attachment ----
    add({
        "case_type": "email", "when": 7 * HOUR, "group": None,
        "label": "fraud-related", "risk": 0.79, "attribution": "spoofed_domain",
        "attribution_reason": "Spoofed vendor domain delivering a macro-enabled document; sending infrastructure is a Netherlands datacenter, not the vendor's.",
        "risk_factors": ["macro-enabled attachment", "extension mismatch", "spoofed vendor domain"],
        "subject": "Invoice 88213 attached — payment overdue",
        "frm": "Billing <billing@vendor-invoices.net>",
        "from_domain": "vendor-invoices.net",
        "return_path": "billing@vendor-invoices.net", "reply_to": "billing@vendor-invoices.net",
        "origin_ip": "193.36.119.12", "relay": "smtp.vendor-invoices.net",
        "body": "Please find attached invoice 88213, now overdue. Enable editing to view the payment details.",
        "reason": "A fake-invoice fraud carrying a macro-enabled Office document whose real type does not match its extension. "
                  "The sender domain spoofs a vendor and the message originated from a Netherlands datacenter.",
        "auth": dict(spf="fail", dkim="none", dmarc="fail", dmarc_policy="none", spf_aligned=False, dkim_aligned=None),
        "geo": dict(ip="193.36.119.12", country="Netherlands", cc="NL", region="North Holland", city="Amsterdam",
                    lat=52.3676, lon=4.9041, isp="Serverius", org="Serverius Datacenter", asn="AS50673", hosting=True,
                    abuse=52, reports=71),
        "hdr_flags": [{"code": "spf_fail", "severity": "high", "detail": "SPF fail — unauthorised sending IP."}],
        "attachments": [attachment(filename="Invoice_88213.docx", size=48211, mime="application/vnd.ms-office",
                                    claimed="docx",
                                    flags=[{"code": "macro_detected", "severity": "high", "detail": "Document contains an auto-executing VBA macro."},
                                           {"code": "extension_mismatch", "severity": "high", "detail": "Real type (OLE/Office 97-2003) does not match the .docx extension."}])],
        "domrep": dict(domain="vendor-invoices.net", age_days=15, malicious=6, suspicious=3, harmless=42, vendors=["Fortinet", "ESET"]),
    })

    # ---- Standalone: Income-tax refund phishing (India theme) ----
    add({
        "case_type": "email", "when": 11 * HOUR, "group": None,
        "label": "phishing", "risk": 0.85, "attribution": "spoofed_domain",
        "attribution_reason": "Impersonates the Income Tax Department; sent via a VPN-anonymised IP with failing authentication.",
        "risk_factors": ["government impersonation", "VPN origin", "refund lure", "DMARC fail"],
        "subject": "Income Tax Refund of ₹15,240 approved — claim now",
        "frm": "Income Tax Dept <refund@incometax-refund-gov.in>",
        "from_domain": "incometax-refund-gov.in",
        "return_path": "refund@incometax-refund-gov.in", "reply_to": "refund@incometax-refund-gov.in",
        "origin_ip": "104.223.91.7", "relay": "vpn-node.datacamp.net",
        "body": "Your income tax refund of ₹15,240 has been approved. Submit your bank details to receive it: "
                "http://incometax-refund-gov.in/claim before it expires.",
        "reason": "A tax-refund lure impersonating the Income Tax Department from a look-alike '.gov.in' domain, sent over a "
                  "VPN-anonymised IP. Authentication fails and the link collects bank details — a refund-scam phishing page.",
        "auth": dict(spf="fail", dkim="none", dmarc="fail", dmarc_policy="reject", spf_aligned=False, dkim_aligned=None),
        "geo": dict(ip="104.223.91.7", country="United States", cc="US", region="California", city="Los Angeles",
                    lat=34.0522, lon=-118.2437, isp="DataCamp Ltd", org="CDN77 / VPN", asn="AS60068", vpn=True,
                    abuse=74, reports=133),
        "hdr_flags": [{"code": "gov_impersonation", "severity": "high", "detail": "Domain imitates a government (.gov.in) identity."},
                      {"code": "vpn_origin", "severity": "medium", "detail": "Origin IP belongs to a commercial VPN range."}],
        "domrep": dict(domain="incometax-refund-gov.in", age_days=9, malicious=9, suspicious=2, harmless=41, vendors=["Kaspersky", "Fortinet"]),
    })

    # ---- Suspicious (medium) — aggressive marketing, partial auth ----
    add({
        "case_type": "email", "when": 4.5 * HOUR, "group": None,
        "label": "suspicious", "risk": 0.46, "attribution": "direct_actor",
        "attribution_reason": "Authentication partially passes but the domain is newly registered and the content uses high-pressure urgency cues.",
        "risk_factors": ["urgency language", "newly registered domain", "SPF pass / DMARC none"],
        "subject": "FINAL NOTICE: claim your reward before midnight",
        "frm": "Rewards Team <promo@mega-rewards-daily.com>",
        "from_domain": "mega-rewards-daily.com",
        "return_path": "promo@mega-rewards-daily.com", "reply_to": "promo@mega-rewards-daily.com",
        "origin_ip": "162.241.62.9", "relay": "smtp.mega-rewards-daily.com",
        "body": "Congratulations! You've been selected for a ₹10,000 reward. Claim before midnight: http://mega-rewards-daily.com/claim",
        "reason": "Authentication technically passes, but the domain is newly registered and the message leans on countdown urgency "
                  "and an unsolicited reward — suspicious marketing worth caution, not a confirmed attack.",
        "auth": dict(spf="pass", dkim="pass", dmarc="none", dmarc_policy="none", spf_aligned=True, dkim_aligned=True),
        "geo": dict(ip="162.241.62.9", country="United States", cc="US", region="Utah", city="Provo",
                    lat=40.2338, lon=-111.6585, isp="Unified Layer", org="Bluehost", asn="AS46606", hosting=True,
                    abuse=18, reports=6),
        "hdr_flags": [{"code": "newly_registered", "severity": "medium", "detail": "Sender domain registered within the last 30 days."}],
        "domrep": dict(domain="mega-rewards-daily.com", age_days=22, malicious=1, suspicious=4, harmless=48, vendors=["Fortinet"]),
    })

    # ---- Legitimate cases (2) ----
    add({
        "case_type": "email", "when": 2.2 * HOUR, "group": None,
        "label": "legitimate", "risk": 0.05, "attribution": "direct_actor",
        "attribution_reason": "Fully authenticated (SPF/DKIM/DMARC all pass and aligned) from the brand's own infrastructure.",
        "risk_factors": [],
        "subject": "Your monthly account statement is ready",
        "frm": "HDFC Bank <estatement@hdfcbank.net>",
        "from_domain": "hdfcbank.net",
        "return_path": "estatement@hdfcbank.net", "reply_to": "estatement@hdfcbank.net",
        "origin_ip": "103.51.150.20", "relay": "mail.hdfcbank.net",
        "body": "Dear Customer, your monthly account e-statement is now available in NetBanking. Log in through the official app to view it.",
        "reason": "A genuine bank statement notice: SPF, DKIM and DMARC all pass and align to the sending domain, the message came from "
                  "the brand's own authenticated infrastructure, and it contains no credential link.",
        "auth": dict(spf="pass", dkim="pass", dmarc="pass", dmarc_policy="reject", spf_aligned=True, dkim_aligned=True),
        "geo": dict(ip="103.51.150.20", country="India", cc="IN", region="Maharashtra", city="Mumbai",
                    lat=19.0760, lon=72.8777, isp="HDFC Bank", org="HDFC Bank Ltd", asn="AS131375", abuse=0, reports=0),
        "hdr_flags": [],
        "domrep": dict(domain="hdfcbank.net", age_days=6800, malicious=0, suspicious=0, harmless=72, vendors=[]),
    })
    add({
        "case_type": "email", "when": 30 * HOUR, "group": None,
        "label": "legitimate", "risk": 0.04, "attribution": "direct_actor",
        "attribution_reason": "Authenticated newsletter from the brand's verified sending domain via a reputable ESP.",
        "risk_factors": [],
        "subject": "Your weekly product digest",
        "frm": "Notion <team@mail.notion.so>",
        "from_domain": "mail.notion.so",
        "return_path": "bounce@mail.notion.so", "reply_to": "team@mail.notion.so",
        "origin_ip": "54.240.9.44", "relay": "a9-44.smtp-out.amazonses.com",
        "body": "Here's what's new this week in your workspace. Manage your email preferences any time from settings.",
        "reason": "A routine authenticated newsletter delivered through Amazon SES on behalf of a verified brand domain. All three "
                  "authentication checks pass and align; nothing about the content or infrastructure is suspicious.",
        "auth": dict(spf="pass", dkim="pass", dmarc="pass", dmarc_policy="quarantine", spf_aligned=True, dkim_aligned=True),
        "geo": dict(ip="54.240.9.44", country="United States", cc="US", region="Virginia", city="Ashburn",
                    lat=39.0438, lon=-77.4874, isp="Amazon SES", org="Amazon.com", asn="AS14618", hosting=True, abuse=0, reports=0),
        "hdr_flags": [],
        "domrep": dict(domain="notion.so", age_days=3200, malicious=0, suspicious=0, harmless=70, vendors=[]),
    })

    # ---- A couple of link cases for the Link-scan view ----
    add({
        "case_type": "link", "when": 1.1 * HOUR, "group": None,
        "raw_input": "http://paypal-account-limited.com/verify",
        "label": "phishing", "risk": 0.92, "attribution": "spoofed_domain",
        "attribution_reason": "PayPal look-alike domain hosting a credential form; unrelated hosting IP.",
        "risk_factors": ["brand lookalike", "credential form", "new domain"],
        "reason": "A PayPal look-alike domain hosting a login form that submits credentials to an unrelated server. Registered days ago "
                  "and already flagged by multiple vendors — a credential-phishing page.",
        "domrep": dict(domain="paypal-account-limited.com", age_days=5, malicious=13, suspicious=3, harmless=37,
                       vendors=["Google Safebrowsing", "Fortinet", "Kaspersky"]),
        "geo": None, "auth": None, "hdr_flags": None,
    })
    add({
        "case_type": "link", "when": 40 * HOUR, "group": None,
        "raw_input": "https://www.wikipedia.org/",
        "inspect_url": "https://www.wikipedia.org/",
        "label": "legitimate", "risk": 0.03, "attribution": "direct_actor",
        "attribution_reason": "Well-established domain, clean reputation, no credential collection.",
        "risk_factors": [],
        "reason": "A well-established, long-registered domain with a clean reputation and no credential-harvesting behaviour — legitimate.",
        "domrep": dict(domain="wikipedia.org", age_days=8200, malicious=0, suspicious=0, harmless=88, vendors=[]),
        "geo": None, "auth": None, "hdr_flags": None,
    })

    return cases


def assemble(case: dict) -> dict:
    """Turn a compact case spec into (row, embedding-group, metadata)."""
    run_id = uuid.uuid4().hex
    created_at = NOW - case["when"]
    date_str = time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime(created_at))

    tool_calls: list[dict] = []
    if case["case_type"] == "email":
        origin_ip = case["origin_ip"]
        chain = [
            hop(0, case["relay"], "mx.recipient.org", origin_ip, date_str,
                ["origin"] + (["tor"] if case["geo"].get("tor") else []) + (["vpn"] if case["geo"].get("vpn") else [])),
            hop(1, "mx.recipient.org", "mail.recipient.org", "10.0.0.5",
                time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime(created_at + 2)), [], public=False),
        ]
        raw_input = raw_email(
            subject=case["subject"], frm=case["frm"], to="you@recipient.org",
            return_path=case["return_path"], reply_to=case["reply_to"], date=date_str,
            origin_ip=origin_ip, relay=case["relay"], body=case["body"],
        )
        tool_calls.append(headers_call(
            frm=case["frm"], from_domain=case["from_domain"], return_path=case["return_path"],
            reply_to=case["reply_to"], subject=case["subject"], origin_ip=origin_ip,
            chain=chain, flags=case["hdr_flags"],
        ))
        tool_calls.append(auth_call(from_domain=case["from_domain"], **case["auth"]))
        tool_calls.append(geo_call(**case["geo"]))
        if case.get("attachments"):
            tool_calls.append(attach_call(case["attachments"]))
    else:
        raw_input = case["raw_input"]
        if case.get("_inspect_call"):
            tool_calls.append(case["_inspect_call"])

    if case.get("domrep"):
        tool_calls.append(domrep_call(**case["domrep"]))

    verdict = {
        "label": case["label"],
        "confidence": round(min(0.99, case["risk"] + 0.03), 2),
        "risk_score": case["risk"],
        "reason": case["reason"],
        "mitigation": ("Do not click any links or reply. Report to your security team and delete the message."
                       if case["risk"] >= 0.5 else None),
        "legitimate_alternatives": [],
        "risk_factors": case.get("risk_factors", []),
        "attribution": case["attribution"],
        "attribution_reason": case["attribution_reason"],
    }

    row = (run_id, case["case_type"], raw_input, created_at,
           json.dumps(verdict), json.dumps(tool_calls), None,
           NOW + 90 * DAY)
    meta = {"run_id": run_id, "case_type": case["case_type"], "raw_input": raw_input,
            "label": case["label"], "reason": case["reason"]}
    return {"row": row, "group": case.get("group"), "meta": meta}


def capture_website(url: str) -> dict | None:
    """Best-effort: open a real URL in the Playwright sandbox, save its
    screenshot, and return an `inspect_website` tool-call record so the
    run-detail page shows a genuine sandbox screenshot. Degrades to None
    (no screenshot) if the browser/page isn't reachable — the link case
    still renders, just without the image."""
    try:
        import asyncio

        sys.path.insert(0, str(BASE))
        from tools.inspect_website import inspect_website

        res = asyncio.run(inspect_website.coroutine(url=url))
        artifact = res[1] if isinstance(res, tuple) else res
        b64 = artifact.get("screenshot_base64")
        shot_path = None
        if b64:
            shots = BASE / "data" / "screenshots"
            shots.mkdir(parents=True, exist_ok=True)
            name = "seed_" + re.sub(r"[^a-z0-9]+", "_", url.lower())[:40].strip("_") + ".png"
            (shots / name).write_bytes(base64.b64decode(b64))
            shot_path = f"data/screenshots/{name}"
        clean = {k: v for k, v in artifact.items() if k != "screenshot_base64"}
        print(f"  captured sandbox screenshot for {url} ({'ok' if shot_path else 'no image'})")
        return {"tool": "inspect_website", "args": {"url": url}, "artifact": clean, "screenshot_path": shot_path}
    except Exception as exc:  # noqa: BLE001 — screenshots are a demo nicety, never fatal
        print(f"  (screenshot capture skipped for {url}: {exc})")
        return None


def synth_embeddings(assembled: list[dict]) -> np.ndarray:
    """768-dim vectors: cases sharing a `group` get near-identical vectors so
    DBSCAN (cosine, eps 0.65, after centering) clusters them into a campaign;
    everything else gets an independent random direction."""
    rng = np.random.default_rng(26106)
    bases: dict[str, np.ndarray] = {}
    vecs = []
    for a in assembled:
        g = a["group"]
        if g:
            if g not in bases:
                bases[g] = rng.normal(size=768)
            v = bases[g] + rng.normal(scale=0.02, size=768)
        else:
            v = rng.normal(size=768)
        v = v / (np.linalg.norm(v) or 1.0)
        vecs.append(v.astype("float32"))
    return np.vstack(vecs)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", action="store_true", help="append instead of wiping existing runs + case memory")
    args = ap.parse_args()

    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    cases = build_cases()
    for c in cases:
        if c["case_type"] == "link" and c.get("inspect_url"):
            call = capture_website(c["inspect_url"])
            if call:
                c["_inspect_call"] = call
    assembled = [assemble(c) for c in cases]

    conn = sqlite3.connect(DB_PATH)
    conn.execute(_SCHEMA)
    if not args.keep:
        conn.execute("DELETE FROM runs")
        if CASE_MEMORY_DIR.exists():
            shutil.rmtree(CASE_MEMORY_DIR)
    conn.executemany(
        "INSERT INTO runs (id, case_type, raw_input, created_at, verdict_json, tool_calls_json, report_path, retain_until) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [a["row"] for a in assembled],
    )
    conn.commit()
    conn.close()

    # Case-memory files (embeddings + metadata) so campaigns form.
    CASE_MEMORY_DIR.mkdir(parents=True, exist_ok=True)
    emb_path = CASE_MEMORY_DIR / "case_embeddings.npy"
    meta_path = CASE_MEMORY_DIR / "case_metadata.json"
    metas = [a["meta"] for a in assembled]
    embeddings = synth_embeddings(assembled)
    if args.keep and emb_path.exists() and meta_path.exists():
        existing = json.loads(meta_path.read_text(encoding="utf-8"))
        existing_emb = np.load(emb_path)
        metas = existing + metas
        embeddings = np.vstack([existing_emb, embeddings]) if existing_emb.size else embeddings
    np.save(emb_path, embeddings)
    meta_path.write_text(json.dumps(metas), encoding="utf-8")

    n_email = sum(1 for a in assembled if a["row"][1] == "email")
    n_link = len(assembled) - n_email
    groups = {a["group"] for a in assembled if a["group"]}
    print(f"Seeded {len(assembled)} runs ({n_email} email, {n_link} link) into {DB_PATH}")
    print(f"Case memory: {len(metas)} entries -> {emb_path.name} / {meta_path.name}")
    print(f"Campaign groups: {sorted(groups)} (each should cluster into a campaign)")
    print("Done. Refresh the dashboard — no backend restart needed.")


if __name__ == "__main__":
    main()
