# Security

The Poland Electricity Demand Forecast runs publicly on free tiers (Render, Neon, Vercel, GitHub Actions). This page lists what could go wrong and what stops it. Each protection is covered by a test or was verified in a production rehearsal.

## Threats and protections

| Threat | Protection | Where |
|---|---|---|
| A visitor retrains the model, refreshes data or changes anything | The public API has **no write endpoints**. Training runs only on the author's machine and is released with `make publish`. A test fails if any route other than `GET` and the read-only `POST /api/whatif` appears | `api/main.py`, `tests/test_security.py` |
| Someone floods the API and the 512 MB server falls over | Limit of **120 requests per minute per visitor** and 3,000 per minute in total; excess requests get HTTP 429. Uvicorn caps concurrent connections at 40 and returns quick 503s beyond that | `security.py`, `backend/Dockerfile` |
| Someone floods the one endpoint that runs the model (What-if) | **30 scenarios per minute per visitor**, at most **2 computations at a time**, and results cached by scenario | `security.py`, `api/main.py` |
| Traffic burns Neon's monthly free compute or Render's bandwidth | Responses are **cached in memory for 10 minutes** and browsers may reuse them for 5. Repeated requests never reach the database. `/api/health` (used by uptime monitors) doesn't touch the database, so Neon can sleep | `api/main.py` |
| A leaked Render credential is used to damage the database | Render connects as **`forecast_api`**, which is **read-only** at the database level, limited to 10 connections, with a 10 s query timeout | `infra/neon/roles.sql` |
| A leaked GitHub secret is used to damage the database | The daily job connects as **`forecast_writer`**: it can add data and forecasts, but can't change the model, delete rows, truncate or drop tables | `infra/neon/roles.sql` |
| Oversized or malformed requests | Request bodies are limited to 8 KB (API) and 16 KB (nginx). All inputs are validated by Pydantic with bounded ranges, and dates outside the data are rejected | `security.py`, `api/main.py` |
| SQL injection | Every query is built with SQLAlchemy Core using bound parameters; no SQL is assembled from strings | `db.py`, `services.py` |
| Rate limits bypassed by faking an IP address | Proxy headers are trusted only when `TRUST_PROXY_HEADERS=true` (on Render, behind its proxy). The limiter keeps at most 10,000 addresses in memory, and the global limit applies to everyone | `security.py` |
| Another site embeds the site in a frame (clickjacking), or injected scripts run | **Content-Security-Policy** (scripts only from the site itself plus one hashed inline script, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy, and a Permissions-Policy that disables camera, microphone and location. HSTS is set on Vercel. The build fails if the inline-script hash drifts | `frontend/vercel.json`, `frontend/security-headers.conf`, `frontend/scripts/check-csp.mjs` |
| Other websites call the API from visitors' browsers | CORS allows only the configured site (`CORS_ORIGINS`), and only `GET` / `POST` | `api/main.py` |
| Secrets end up in the code or the website | `.env` is git-ignored. Database URLs live only in Render's environment, GitHub Secrets and the local `.env`. `VITE_*` variables are public by design and hold only URLs, never secrets | `.gitignore`, `docs/DEPLOY.md` |
| A compromised dependency or a CI workflow with too many rights | Workflows run with read-only repository permissions, and secrets are used only by the scheduled job (never on pull requests). Dependencies are locked. Dependabot proposes updates weekly and CI tests them | `.github/` |
| Loading a model executes code | Models are stored as LightGBM's **text format** and loaded with `Booster(model_str=…)`; nothing is unpickled | `model_store.py` |
| The server reveals internals | No version banners (`--no-server-header`, `server_tokens off`). Unexpected errors return a generic 500 without a stack trace. The containers run as a non-root user | `backend/Dockerfile`, `frontend/nginx.conf` |

## Verified in a production rehearsal

The production image was run locally under Render's 512 MB memory limit, against a separate database set up with `roles.sql`:

- All pages worked with the read-only user. The API user's `INSERT`, `UPDATE`, `DELETE`, `DROP` and `CREATE` attempts were all refused by Postgres. The writer was refused for `DELETE`, `TRUNCATE`, `DROP` and any change to the model tables.
- From 150 rapid requests by one visitor, 120 were answered and 30 got HTTP 429, while another visitor was unaffected. From 40 what-if scenarios, 30 ran and 10 were limited. A 20 KB request body got 413.
- Memory use: about 137 MB of 512 MB.
- The daily job ran successfully as `forecast_writer`.

## Not covered (accepted for a free portfolio demo)

- **Distributed attacks** from many addresses are beyond an in-app limiter. Render and Vercel provide edge DDoS protection, and the global limit and caching keep the database safe even then.
- **Rate-limit state lives in memory**, so it resets when Render restarts the instance. That's acceptable for a single instance.
- `/api/docs` (interactive API documentation) is public on purpose, as part of the portfolio.

## Your own account security

- Turn on two-factor authentication on GitHub, Render, Vercel and Neon.
- Protect the `main` branch on GitHub: require pull requests and green CI.
- Keep GitHub's secret scanning and Dependabot alerts enabled (on by default for public repositories).
- If a credential leaks, reset it right away:
  - Neon: `ALTER ROLE forecast_api PASSWORD '…'`;
  - then update Render's environment or the GitHub secret.
