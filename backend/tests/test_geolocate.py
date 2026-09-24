import pytest

from tools import geolocate


@pytest.fixture
def intel_dir(tmp_path, monkeypatch):
    from config import get_settings

    (tmp_path / "x4bnet_vpn_ipv4.txt").write_text("# header\n198.51.100.0/24\n198.51.100.128/25\n203.0.113.0/28\n")
    (tmp_path / "x4bnet_datacenter_ipv4.txt").write_text("192.0.2.0/24\n")
    (tmp_path / "tor_exit_nodes.txt").write_text("185.220.101.34\n")
    monkeypatch.setenv("INTEL_DIR", str(tmp_path))
    monkeypatch.setenv("TOR_LIST_MAX_AGE_HOURS", "1000")
    monkeypatch.setenv("GEOIP_CITY_DB_PATH", str(tmp_path / "missing.mmdb"))
    get_settings.cache_clear()
    geolocate._ranges.cache_clear()
    geolocate._tor_cache.update(loaded_at=0.0, ips=None)
    yield tmp_path
    get_settings.cache_clear()
    geolocate._ranges.cache_clear()


def test_cidr_lists(intel_dir):
    assert geolocate._in_list("198.51.100.200", "x4bnet_vpn_ipv4.txt") is True
    assert geolocate._in_list("203.0.113.20", "x4bnet_vpn_ipv4.txt") is False
    assert geolocate._in_list("192.0.2.9", "x4bnet_datacenter_ipv4.txt") is True
    assert geolocate._in_list("192.0.2.9", "nope.txt") is None


async def test_tor_origin_flags_anonymized(intel_dir, monkeypatch):
    async def fake_ipapi(ip):
        return {"source": "ip-api.com", "country": "Germany", "isp": "ForPrivacyNET", "proxy": True, "hosting": True}

    monkeypatch.setattr(geolocate, "_ipapi_lookup", fake_ipapi)
    result = await geolocate.geolocate_ip.ainvoke({"ip": "185.220.101.34"})
    assert result["location"]["country"] == "Germany"
    assert result["infrastructure"] == {"is_tor": True, "is_vpn": False, "is_proxy": True, "is_hosting": True, "anonymized": True}
    assert result["reputation"]["available"] is False


async def test_private_ip_not_geolocated():
    result = await geolocate.geolocate_ip.ainvoke({"ip": "192.168.1.20"})
    assert result["available"] is False
