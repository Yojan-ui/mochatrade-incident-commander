from fastapi.testclient import TestClient

from app import demo, main
from app.collectors.dns_collect import DomainNotFound

client = TestClient(main.app)


def test_health():
    assert client.get("/api/health").json()["status"] == "ok"


def test_demo_list_and_every_scenario_renders():
    scenarios = client.get("/api/demo").json()
    assert {s["id"] for s in scenarios} == set(demo.SCENARIOS)
    for s in scenarios:
        body = client.get(f"/api/demo/{s['id']}").json()
        assert body["mode"] == "demo"
        assert 0 <= body["score"] <= 100
        assert len(body["checks"]) == 7


def test_unknown_demo_is_404():
    assert client.get("/api/demo/nope").status_code == 404


def test_demo_error_endpoint():
    assert client.get("/api/demo-error/504").status_code == 504


def test_scan_rejects_bad_domain():
    response = client.get("/api/scan", params={"domain": "not a domain"})
    assert response.status_code == 422


def test_scan_maps_nxdomain_to_404(monkeypatch):
    async def fake_run_scan(domain, selectors, settings):
        raise DomainNotFound(domain)

    monkeypatch.setattr(main, "run_scan", fake_run_scan)
    assert client.get("/api/scan", params={"domain": "nope.example"}).status_code == 404


def test_scan_normalises_input(monkeypatch):
    seen = {}

    async def fake_run_scan(domain, selectors, settings):
        seen.update(domain=domain, selectors=selectors)
        from app.scanner import build_report
        return build_report(demo.observations_for("startup"), mode="live", duration_ms=1)

    monkeypatch.setattr(main, "run_scan", fake_run_scan)
    response = client.get("/api/scan", params={"domain": "https://Example.com/x", "dkim_selectors": "s1,s2"})
    assert response.status_code == 200
    assert seen == {"domain": "example.com", "selectors": ["s1", "s2"]}


def test_static_index_is_served():
    assert "SecureMailScope" in client.get("/").text
