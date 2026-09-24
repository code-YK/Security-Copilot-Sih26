"""
`geolocate_ip` tool — where an IP is, who runs it, and whether it's
anonymizing infrastructure.

  * Location / ISP: MaxMind GeoLite2 (offline .mmdb) when present, else
    ip-api.com (free, keyless, 45 req/min).
  * TOR: the Tor Project's bulk exit list, cached under INTEL_DIR and
    re-downloaded when older than TOR_LIST_MAX_AGE_HOURS (a stale copy is
    used if the refresh fails).
  * VPN / hosting: X4BNet's vendored CIDR lists (data/intel/, refreshed
    manually), plus ip-api's proxy/hosting flags when it was queried.
  * Reputation: AbuseIPDB, if ABUSEIPDB_API_KEY is set.
Every source degrades independently, same as domain_reputation.py.
"""
from __future__ import annotations

import asyncio
import bisect
import ipaddress
import time
from functools import lru_cache
from pathlib import Path

import httpx
from langchain_core.tools import tool

from config import get_settings
from logger import get_logger

logger = get_logger(__name__)

_VPN_LIST = "x4bnet_vpn_ipv4.txt"
_DATACENTER_LIST = "x4bnet_datacenter_ipv4.txt"
_TOR_FILE = "tor_exit_nodes.txt"


@lru_cache(maxsize=None)
def _ranges(filename: str) -> tuple[list[int], list[int]]:
    """Merged, sorted (starts, ends) integer ranges so a lookup is one bisect."""
    path = Path(get_settings().INTEL_DIR) / filename
    if not path.exists():
        return [], []
    spans = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            try:
                net = ipaddress.ip_network(line, strict=False)
            except ValueError:
                continue
            spans.append((int(net.network_address), int(net.broadcast_address)))
    spans.sort()
    starts, ends = [], []
    for start, end in spans:
        if ends and start <= ends[-1] + 1:
            ends[-1] = max(ends[-1], end)
        else:
            starts.append(start)
            ends.append(end)
    return starts, ends


def _in_list(ip: str, filename: str) -> bool | None:
    starts, ends = _ranges(filename)
    if not starts:
        return None
    addr = ipaddress.ip_address(ip)
    if addr.version != 4:
        return None  # the vendored lists are IPv4-only
    value = int(addr)
    i = bisect.bisect_right(starts, value) - 1
    return i >= 0 and value <= ends[i]


_tor_cache: dict = {"loaded_at": 0.0, "ips": None}


def _tor_exits() -> set[str] | None:
    settings = get_settings()
    path = Path(settings.INTEL_DIR) / _TOR_FILE
    max_age = settings.TOR_LIST_MAX_AGE_HOURS * 3600
    if not path.exists() or time.time() - path.stat().st_mtime > max_age:
        try:
            response = httpx.get(settings.TOR_EXIT_LIST_URL, timeout=settings.THREAT_INTEL_TIMEOUT_SECONDS)
            response.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(response.text, encoding="utf-8")
        except Exception as exc:  # noqa: BLE001 — fall back to whatever copy we already have
            logger.warning("Tor exit list refresh failed: %s", exc)
    if not path.exists():
        return None
    mtime = path.stat().st_mtime
    if _tor_cache["ips"] is None or _tor_cache["loaded_at"] != mtime:
        _tor_cache["ips"] = {l.strip() for l in path.read_text(encoding="utf-8").splitlines() if l.strip()}
        _tor_cache["loaded_at"] = mtime
    return _tor_cache["ips"]


@lru_cache(maxsize=None)
def _mmdb_reader(path: str):
    if not Path(path).exists():
        return None
    import geoip2.database

    return geoip2.database.Reader(path)


def _mmdb_lookup(ip: str) -> dict | None:
    settings = get_settings()
    city_reader = _mmdb_reader(settings.GEOIP_CITY_DB_PATH)
    if city_reader is None:
        return None
    result: dict = {"source": "maxmind"}
    try:
        city = city_reader.city(ip)
        result.update(
            country=city.country.name, country_code=city.country.iso_code,
            region=city.subdivisions.most_specific.name, city=city.city.name,
            lat=city.location.latitude, lon=city.location.longitude,
        )
    except Exception as exc:  # noqa: BLE001 — AddressNotFoundError etc.
        logger.info("MaxMind city lookup failed for %s: %s", ip, exc)
        return None
    asn_reader = _mmdb_reader(settings.GEOIP_ASN_DB_PATH)
    if asn_reader is not None:
        try:
            asn = asn_reader.asn(ip)
            result.update(isp=asn.autonomous_system_organization, org=asn.autonomous_system_organization,
                          asn=f"AS{asn.autonomous_system_number}")
        except Exception:  # noqa: BLE001
            pass
    return result


async def _ipapi_lookup(ip: str) -> dict | None:
    fields = "status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,proxy,hosting"
    try:
        async with httpx.AsyncClient(timeout=get_settings().THREAT_INTEL_TIMEOUT_SECONDS) as client:
            response = await client.get(f"http://ip-api.com/json/{ip}", params={"fields": fields})
            data = response.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("ip-api lookup failed for %s: %s", ip, exc)
        return None
    if data.get("status") != "success":
        return None
    return {
        "source": "ip-api.com", "country": data.get("country"), "country_code": data.get("countryCode"),
        "region": data.get("regionName"), "city": data.get("city"), "lat": data.get("lat"), "lon": data.get("lon"),
        "isp": data.get("isp"), "org": data.get("org"), "asn": (data.get("as") or "").split(" ")[0] or None,
        "proxy": data.get("proxy"), "hosting": data.get("hosting"),
    }


async def _abuseipdb(ip: str) -> dict:
    settings = get_settings()
    if not settings.ABUSEIPDB_API_KEY:
        return {"available": False, "detail": "ABUSEIPDB_API_KEY not configured"}
    try:
        async with httpx.AsyncClient(timeout=settings.THREAT_INTEL_TIMEOUT_SECONDS) as client:
            response = await client.get(
                "https://api.abuseipdb.com/api/v2/check",
                params={"ipAddress": ip, "maxAgeInDays": 90},
                headers={"Key": settings.ABUSEIPDB_API_KEY, "Accept": "application/json"},
            )
            response.raise_for_status()
            data = response.json().get("data", {})
    except Exception as exc:  # noqa: BLE001
        logger.warning("AbuseIPDB lookup failed for %s: %s", ip, exc)
        return {"available": False, "detail": f"AbuseIPDB unavailable: {exc}"}
    return {
        "available": True, "abuse_confidence_score": data.get("abuseConfidenceScore"),
        "total_reports": data.get("totalReports"), "usage_type": data.get("usageType"),
        "is_tor": data.get("isTor"), "domain": data.get("domain"),
    }


async def geolocate(ip: str) -> dict:
    try:
        addr = ipaddress.ip_address(ip.strip())
    except ValueError:
        return {"ip": ip, "available": False, "detail": "Not a valid IP address"}
    ip = str(addr)
    if not addr.is_global:
        return {"ip": ip, "available": False, "detail": "Private or reserved address — not geolocatable"}

    location = await asyncio.to_thread(_mmdb_lookup, ip)
    ipapi = None
    if location is None or not location.get("isp"):
        ipapi = await _ipapi_lookup(ip)
        location = {**(ipapi or {}), **(location or {})} or None

    tor_ips, reputation = await asyncio.gather(asyncio.to_thread(_tor_exits), _abuseipdb(ip))
    is_tor = (ip in tor_ips) if tor_ips is not None else None
    if reputation.get("is_tor"):
        is_tor = True
    is_vpn = _in_list(ip, _VPN_LIST)
    is_hosting = _in_list(ip, _DATACENTER_LIST)
    if ipapi and ipapi.get("hosting"):
        is_hosting = True

    return {
        "ip": ip,
        "available": location is not None,
        "location": location,
        "infrastructure": {
            "is_tor": is_tor,
            "is_vpn": is_vpn,
            # Informational only: ip-api flags even Google's mail servers and 8.8.8.8 as "proxy".
            "is_proxy": ipapi.get("proxy") if ipapi else None,
            "is_hosting": is_hosting,
            "anonymized": bool(is_tor or is_vpn),
        },
        "reputation": reputation,
    }


@tool
async def geolocate_ip(ip: str) -> dict:
    """Geolocates an IP address (country, region, city, ISP/organisation) and checks whether it is a TOR exit node, a known VPN/proxy, or a hosting/datacenter address, plus its abuse-report score. Use on an email's originating IP or a website's hosting IP."""
    try:
        return await geolocate(ip)
    except Exception as exc:  # noqa: BLE001
        logger.warning("geolocate_ip failed for %s: %s", ip, exc)
        return {"ip": ip, "available": False, "detail": f"Geolocation failed: {exc}"}
