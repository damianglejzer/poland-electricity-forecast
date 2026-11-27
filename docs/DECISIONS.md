# Decisions and trade-offs

Short notes on the choices made while building this project: what was decided, why, and what else was considered.

---

## Data

### 1. PSE API v2, entity `kse-load`, as the single demand source
**What.** Actual national demand and PSE's official forecast both come from `GET https://api.raporty.pse.pl/api/kse-load` (fields `load_actual` and `load_fcst`, one row per 15 minutes), filtered with OData (`$filter=business_date ge '…' and business_date le '…'`) and paged via `nextLink`.
**Why.** The PSE API was replaced in June 2025, and most tutorials still use v1 endpoints. `kse-load` holds the **target and the benchmark in one entity, on the same basis**, so they can't drift apart. It also publishes tomorrow's PSE forecast by ~09:00. One request returns a full month (~2,976 rows), so a full history download takes seconds.
**Alternatives.** `his-wlk-cal` (`demand` matches `load_actual`, but it has no forecast); `pk5l-wp` (hourly coordination plan, a different forecast product); ENTSO-E (needs a token, so it is left as a future optional source).

### 2. Use data only from 14 June 2024
**What.** History starts on `2024-06-14` (`DATA_START` in `config.py`).
**Why.** On that date PSE switched from publishing **gross** to **net** demand, so the two periods aren't comparable. `kse-load` itself starts that day, and both `load_actual` and `load_fcst` are net values. The model, the baseline and PSE's forecast are therefore all scored on the same basis.
**Alternatives.** Rescale the older gross data with an estimated own-use factor. Rejected: it adds noise and assumptions for little gain, since 2+ years of net data is enough for a daily/weekly/annual pattern.

### 3. Timestamps: UTC interval start as the key
**What.** `dtime_utc` marks the **end** of the 15-minute interval, so the stored key is `ts_utc = dtime_utc − 15 min`. The local `business_date` is kept for grouping. Day boundaries are computed in `Europe/Warsaw`, so DST days have 92 or 100 slots instead of 96.
**Why.** The local `dtime` is ambiguous on the autumn DST day: PSE writes the repeated hour as `02a:15:00`. UTC keys are unique and sortable. A recorded fixture for 2025-10-26 is covered by a test.
**Trade-off.** Same-slot lags are computed in UTC, so around DST changes they are off by one hour for a few days a year. The effect is negligible.

### 4. Weather: Open-Meteo *historical forecast* API, population-weighted
**What.** Hourly temperature, cloud cover, shortwave radiation and wind speed for 8 metro areas (Warsaw, Katowice/GZM, Kraków, Wrocław, Tricity, Łódź, Poznań, Szczecin), weighted by approximate metro population, interpolated to 15 minutes.
**Why.** The historical-forecast archive stores **forecasts**, not observations, so training inputs have the same kind of error as the inputs at prediction time. The same endpoint also covers the next few days, so training and inference use one source. Metro weights are a cheap proxy for where demand is.
**Caveat (important for interpreting results).** The archive stitches together the *freshest* model runs, so for a given day it holds weather that is a few hours to a day "younger" than what was really known on the morning of D-1. That gives the model a small information advantage over PSE in the backtest, so the edge over PSE should be read as slightly optimistic. A strictly fair comparison needs archived D-1 06:00 forecast runs (Open-Meteo's "previous runs" API), which is a natural next step.
**Alternatives.** ERA5 reanalysis (`archive-api`), which is cleaner but doesn't match inference-time quality and has a ~5-day lag; one city only (Warsaw), which is simpler but misses regional weather.

### 5. Pandera validation at ingestion
Range checks (demand 5–40 GW, cloud cover 0–100 %, …), uniqueness and the 15-minute grid are enforced before anything is written. On the first real run this caught a population-weighted cloud cover of `100.00000000000001 %`, which led to rounding the weighted averages. Bad data fails loudly instead of silently reaching training.

---

## Storage and infrastructure

### 6. PostgreSQL rather than DuckDB
**Why.** The API reads while background refresh and training jobs write, and Postgres handles concurrent readers and writers well. MLflow needs a backend store anyway, so one Postgres instance serves both (two databases). It is also the setup most teams run in production.
**Alternative.** DuckDB would be simpler (a single file, fast analytics), but its single-writer model fits poorly with a long-running API plus background jobs, and MLflow can't use it.
**Portability.** The schema is SQLAlchemy Core and the upsert helper supports Postgres and SQLite, so tests run against in-memory SQLite with no database container.

### 7. MLflow for tracking and the registry; the database for serving
**What.** Each training run logs params, metrics, feature importance and the LightGBM model to MLflow 2.22, registers it as `pse-demand-lgbm` and moves the `production` alias. The booster is **also** stored as text in a `model_artifacts` table; the API and the daily job load the version `model_runs` marks as current.
**Why.** Serving needs no disk and no MLflow server, so the API is stateless and fits free, disk-less hosting (Render's file system is wiped on every deploy). MLflow stays where it adds value: comparing runs while developing. If MLflow is unreachable, training still succeeds with a `local-…` version (checked with a 3-second health probe rather than MLflow's long retry loop).
**Gotcha found.** `mlflow==2.22.1` breaks with SQLAlchemy 2.1, so the MLflow image pins `sqlalchemy<2.1`. MLflow 2.x was chosen over 3.x for its stable, well-known registry API.

### 8. Training offline, forecasting on a schedule, a read-only public API
**What.** The first version could refresh data and retrain from buttons in the UI, run in a thread inside the API. That was removed. Now:
- **Training** runs offline (`make train`) and is reviewed in MLflow.
- **`make publish`** promotes the model, data and evaluation to the public database.
- **A GitHub Actions cron job** (`cli daily`) refreshes data and forecasts tomorrow with the published model.
- **The API** only reads.

**Why.**
- *Free-tier limits.* Training needs ~1 GB RAM; Render's free instance has 512 MB and sleeps when idle, so it can neither train nor run a schedule.
- *Safety.* Public visitors can't start expensive jobs or change the model.
- *Governance.* A model goes live only after a human has looked at its evaluation, which is the usual way production ML is run.

**Alternatives.** Automatic retraining on a schedule (easy to add as another workflow, but it would publish unreviewed models); a worker queue (overkill for one daily job).

### 9. Everything runs in Docker; tooling pinned
- Python runs in containers (uv + lockfile), Node only at build time, and Playwright runs from the official image, so the only host requirement is Docker (plus `make`).
- `uv` resolves with `exclude-newer` (packages published ≥ 2 weeks before the build), npm dependencies are pinned to exact versions, and images are tagged.

---

## Modelling

### 10. Forecast setting: issued on the morning of D-1, so demand features are ≥ 48 h old
**What.** Lags: same slot 2, 7 and 14 days ago; daily mean/peak of D-2 and mean of D-7. Nothing from D-1 or D is used.
**Why.** That matches what PSE knows when it publishes its day-ahead forecast, and it guarantees no leakage. A unit test overwrites demand on D and D-1 and asserts the features for D are unchanged.
**Trade-off.** Adding D-1 morning actuals would improve accuracy somewhat, but it complicates the cutoff logic; it's left for a later version.

### 11. Features
Calendar: quarter-hour slot with sin/cos, day of week, weekend, Polish holiday, bridge day, Christmas period, day type, month, season. Weather: the four variables plus daily mean temperature and heating/cooling degrees (bases 15 °C / 22 °C). **PSE's forecast is deliberately not a feature**: it is the benchmark, and using it would make the comparison meaningless.

### 12. Model: LightGBM with an L1 objective
L1 (MAE) is robust to occasional data spikes and aligns with MAPE. The hyper-parameters are sensible defaults (lr 0.03, 63 leaves, bagging), not tuned. The number of trees comes from early stopping on the 30 days before the test window.
**Alternatives.** Per-slot linear models, Prophet, gradient boosting with quantiles. LightGBM gives the best accuracy per minute of effort and fast TreeSHAP.

### 13. Evaluation: one time-based hold-out, then refit
- Test = the last **60 complete days** (configurable via `TEST_DAYS`); training = everything before, with validation = the 30 days before the test window.
- Metrics (MAPE, MAE, RMSE) are computed on the **same slots** for all three forecasts (rows where any of them is missing are dropped).
- The production model is refit on all labelled data with the same number of rounds.
**Trade-off.** One hold-out window is noisier than a rolling-origin backtest; rolling-origin is listed as a next step.

### 14. Three kinds of stored predictions, and an append-only live record
- **`forecast`:** ex-ante, made by the deployed model before the day starts.
- **`backtest`:** out-of-sample on the test window.
- **`insample`:** the training period, shown with a label.

The UI prefers forecast > backtest > in-sample per slot. The accuracy KPIs use only out-of-sample kinds.

**Ex-ante rule.** Once a day has started (Warsaw time), its stored forecast is never replaced, neither by the daily job, a retrain nor `publish` (which only *adds* forecast rows). Tomorrow's forecast may still be refreshed, e.g. by the second daily run. This makes the **live track record** (`/api/track-record`) trustworthy: it is what the model really said the day before.

### 15. Baseline: same slot 7 days earlier
It's the standard seasonal-naive benchmark for load. It's weak on and after holidays (10.8 % MAPE on 15 August), which the day-type chart makes visible.

---

## Explainability and what-if

### 16. SHAP from LightGBM's built-in TreeSHAP (`pred_contrib=True`)
Exact SHAP values with no extra dependency. Global importance is the mean |SHAP| on the test window, grouped into *recent demand / calendar / weather*.
**Performance.** SHAP over ~1,000 trees took ~0.6 s per 96-row day. The what-if endpoint therefore explains one slot per hour (24 rows) and caches the unchanged day per model version, so a slider move takes ~0.2 s.

### 17. What-if mechanics
- **Temperature**: shifts the forecast temperature, and degree days and the daily mean are recomputed.
- **Cloud cover**: overrides cloud cover and scales solar radiation with the Kasten–Czeplak factor `1 − 0.75·(c/100)^3.4`, so "clear sky" also means more sun (and lower net demand thanks to behind-the-meter PV).
- **Holiday / day of week**: change the calendar features only. Recent-demand lags stay as observed, so this answers "what if this day *behaved like* a Sunday" rather than re-simulating the past week. The UI says so.

---

## Frontend

### 18. React + Vite + Tailwind + ECharts + TanStack Query, written for non-specialists
ECharts handles 200+ point time series with crosshair tooltips and renders to SVG for crisp screenshots. Only the chart types in use are registered (tree-shaken `echarts/core`), which cut the chart bundle from 350 kB to 190 kB gzipped. TanStack Query provides caching, retries (useful while the free API wakes up) and keep-previous-data, which makes date paging and sliders feel smooth.

The audience is a recruiter, not an energy analyst:
- every chart has a collapsible "What am I looking at?" explanation;
- jargon (MAPE, GW, PSE, SHAP) has hover definitions;
- What-if has one-click scenarios;
- the architecture is drawn with plain HTML components instead of Mermaid, which is lighter and matches the theme.

Headline claims are computed from the data (e.g. "more accurate than the official forecast" only appears when it is true).

### 19. Theme and chart colours
Follows the operating system's light/dark preference. An explicit toggle is remembered in `localStorage`. The theme is applied before first paint to avoid a flash. Series colours are the first three slots of a validated categorical palette, checked with a colour-vision-deficiency validator in both modes: model = blue, PSE = orange, naive = aqua (always dashed, because aqua falls below 3:1 contrast on white). Actual demand uses the primary ink colour.

### 20. Timezone-independent labels
The API returns local Warsaw timestamps with offsets, and the UI reads wall-clock parts straight from the string. Charts therefore show Polish time even when the browser runs in another timezone (e.g. the UTC Playwright container).

---

## Deployment

### 21. Vercel + Render + Neon + GitHub Actions
All four have free tiers that need no credit card and deploy from the GitHub repository:
- Vercel serves the static site.
- Render runs the API container.
- Neon is serverless PostgreSQL.
- GitHub Actions runs the daily job and CI.

Compared with one VM running Docker Compose, there is no server to maintain, and the split mirrors a typical cloud architecture. The cost is cold starts (handled below) and no MLflow server in production (not needed: see 7).

### 22. Cold starts
Render's free API sleeps after 15 minutes. The site pings `/api/health` as soon as it loads. If a request takes more than 3 s, it shows a friendly "Waking up the server" note with a timer instead of an empty page. Queries retry twice. An external uptime monitor pinging `/api/health` every 10 minutes (see DEPLOY.md) keeps the API warm.

### 23. One codebase, two runtimes
The backend Dockerfile has a `dev` target (dev tools and tests, used by Compose and `make test`) and a slim `prod` default target. It has no dev dependencies, runs as a non-root user and listens on `$PORT`. CI builds and smoke-tests the `prod` image on every push, so a broken Render build is caught before deploy. Database URLs in the `postgres://` form shown by Neon are accepted as-is (normalised to the psycopg driver).

### 24. Rehearsing production locally
Before release, the full production path was run locally:
1. publish to a separate database;
2. run the `prod` image with `--memory=512m` against it (≈135 MB used; every endpoint < 0.6 s);
3. serve a frontend built with `VITE_API_URL` pointing at it, from another origin (exercises CORS), and run the Playwright suite;
4. run `cli daily` from a clean Python environment the way GitHub Actions does, checking that today's forecast is kept and tomorrow's is written.

### 25. Security for a public, free-tier deployment
The API is read-only by construction, so the remaining risks are abuse and leaked credentials. Defences are layered:
- in-memory per-visitor and global rate limits, with a stricter one plus a concurrency cap for the model-running what-if endpoint;
- response caching (data changes once a day), so floods don't reach Neon's metered compute;
- body-size limits and bounded inputs;
- separate database users: the API is read-only with a statement timeout; the daily job can only insert and update data tables; only the author's machine holds the owner password;
- CSP and security headers on the site.

**Alternatives.** A Redis-backed limiter (more robust across restarts and instances, but another service to host for one small instance) and an API gateway (paid tiers). Full threat list in [SECURITY.md](SECURITY.md).

## Process notes
- `make` wasn't installed at the start; the user installed it, so no wrapper script was needed.
- Git identity for this repo was set locally (`git config user.*`) because no global identity existed.
- Retraining on a later window (26 Sep – 24 Nov 2026) produced a weaker result than PSE (2.51 % vs 1.96 % MAPE), whereas the first window (10 Aug – 8 Oct) had beaten it (2.11 % vs 2.33 %). Re-running the pre-rebuild code on the same data gave identical numbers, so this is seasonality, not a regression. The site states results as computed instead of tuning against the test window.
