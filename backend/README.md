# SecureMailScope backend

FastAPI service that grades a domain's email security across 7 vectors and names **The One Fix**: the single DNS change that closes the most attack paths.

## Run locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8000   # http://localhost:8000/docs
.venv/bin/python -m pytest
```

Docker (from the repo root): `docker build -t securemailscope . && docker run -p 8080:80 securemailscope`

## Endpoints

| Route | Purpose |
|---|---|
| `GET /api/scan?domain=example.com[&dkim_selectors=s1,s2]` | Live scan (DNS + port-25 STARTTLS probe) |
| `GET /api/demo` | List canned scenarios |
| `GET /api/demo/{id}?delay_ms=1500` | Canned report run through the real engine, with optional latency |
| `GET /api/demo-error/{404,422,500,504}` | Forced error responses for UI error states |
| `GET /api/health` | Liveness |

## How it works

`collectors/` gather raw **Observations** (no judgement). `analysis/checks.py` scores each vector against the weight matrix (DMARC 25, SPF 15, DKIM 15, STARTTLS 15, MTA-STS 12, MX 10, TLS-RPT 8). Vectors that don't apply, or couldn't be measured (e.g. port 25 blocked), are dropped from the denominator. `analysis/scoring.py` maps the posture to attack paths, then finds The One Fix by **simulation**: it applies each candidate record to a copy of the observations, re-runs the analysis, and ranks by severity of paths closed, then score gained, then effort.

It never recommends a fix that would break mail: no DMARC enforcement without passing SPF/DKIM, and no MTA-STS enforce over a missing or invalid TLS certificate.

## Configuration (env vars)

`DNS_TIMEOUT` (4), `SMTP_TIMEOUT` (8), `HTTP_TIMEOUT` (5), `EHLO_HOSTNAME`, `CORS_ORIGINS`, `STATIC_DIR`, `ALLOW_PRIVATE_TARGETS` (false: refuses to probe private/loopback IPs, to prevent SSRF).
