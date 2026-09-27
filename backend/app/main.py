"""SecureMailScope API."""

from __future__ import annotations

import asyncio
import time

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import demo
from app.collectors.dns_collect import DomainNotFound
from app.config import get_settings
from app.domain import InvalidDomain, normalize_domain, parse_selectors
from app.models import DemoScenario, ScanReport
from app.scanner import build_report, run_scan

settings = get_settings()

app = FastAPI(
    title="SecureMailScope API",
    version="0.1.0",
    description="Email-security posture scanner: SPF, DKIM, DMARC, MTA-STS, TLS-RPT, MX and a live STARTTLS probe.",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET"], allow_headers=["*"])


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": app.version}


@app.get("/api/scan", response_model=ScanReport)
async def scan(
    domain: str = Query(..., max_length=300, description="Domain, URL or email address to scan"),
    dkim_selectors: str | None = Query(None, description="Comma-separated extra DKIM selectors to try"),
) -> ScanReport:
    try:
        normalized = normalize_domain(domain)
        selectors = parse_selectors(dkim_selectors)
    except InvalidDomain as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    try:
        return await run_scan(normalized, selectors, settings)
    except DomainNotFound:
        raise HTTPException(status_code=404, detail=f"{normalized} does not exist (NXDOMAIN)") from None


# ---- Dummy endpoints for UI development (no network access) ---------------- #


@app.get("/api/demo", response_model=list[DemoScenario])
async def demo_scenarios() -> list[DemoScenario]:
    return demo.list_scenarios()


@app.get("/api/demo/{scenario_id}", response_model=ScanReport)
async def demo_scan(
    scenario_id: str,
    delay_ms: int = Query(0, ge=0, le=15000, description="Artificial latency, to exercise loading states"),
) -> ScanReport:
    started = time.monotonic()
    obs = demo.observations_for(scenario_id)
    if obs is None:
        known = ", ".join(s.id for s in demo.list_scenarios())
        raise HTTPException(status_code=404, detail=f"Unknown scenario '{scenario_id}'. Try one of: {known}")
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)
    return build_report(obs, mode="demo", duration_ms=int((time.monotonic() - started) * 1000))


@app.get("/api/demo-error/{status_code}")
async def demo_error(status_code: int) -> None:
    """Force an error response so the UI's error states can be built."""
    messages = {404: "nonexistent.example does not exist (NXDOMAIN)", 422: "'not a domain' is not a valid domain name",
                500: "Internal server error", 504: "Scan timed out"}
    if status_code not in messages:
        raise HTTPException(status_code=400, detail=f"Supported codes: {sorted(messages)}")
    raise HTTPException(status_code=status_code, detail=messages[status_code])


# ---- Static frontend (mounted last so /api/* wins) ------------------------- #

if settings.static_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
