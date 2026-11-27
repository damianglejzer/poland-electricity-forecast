# Deploying GridCast (free tiers)

This guide puts the project online with four free services:

```
Your laptop ── make publish ──►  Neon (PostgreSQL)  ◄── GitHub Actions (daily forecast)
                                       ▲
                                Render (FastAPI)  ◄──  Vercel (React website)
```

| Service | Role | Free tier notes |
|---|---|---|
| **Neon** | PostgreSQL database: data, forecasts, metrics and the model itself | 0.5 GB storage (the project uses ~60 MB); sleeps after 5 min idle, wakes in ~1 s |
| **Render** | The API (`backend/Dockerfile`, `prod` stage) | 512 MB RAM (the API uses ~140 MB); **sleeps after 15 min idle**, first request then takes ~30–60 s |
| **Vercel** | The website (static build of `frontend/`) | Plenty for a portfolio |
| **GitHub Actions** | Daily job: download new data and forecast tomorrow | Free for public repositories |

Allow about 30–45 minutes. Do the steps in order: each one needs a value from the previous one.

---

## 0. Before you start

- The app runs locally and has a trained model (`make up && make refresh && make train`), and you are happy with the run in MLflow (http://localhost:5000).
- You have accounts on **GitHub**, **Neon**, **Render** and **Vercel**. Signing in to the last three with GitHub is easiest.

## 1. Push the code to GitHub

1. On GitHub, create a new **empty, public** repository (no README or license; for example `gridcast`).
2. In the project folder:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/gridcast.git
   git push -u origin main
   ```
3. In `README.md`, replace `YOUR-USERNAME` / `YOUR-APP` later, once you know the URLs.

## 2. Create the database (Neon)

1. Neon console → **New project**. Name it `gridcast`, choose region **AWS Europe Central (Frankfurt)** (close to Render's Frankfurt region) and Postgres 16 or newer.
2. On the project dashboard click **Connect** and copy the connection string. It looks like:
   ```
   postgresql://neondb_owner:xxxxx@ep-something-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```
   Use the plain (not "pooled") string. You can paste it as-is: the app converts `postgresql://` to the right driver itself.
3. Keep it secret: this is the **owner** password, which can change or delete everything. It
   stays on your laptop only. Render and GitHub get limited users (step 3b).

## 3. Publish your model and data to Neon

1. Put the connection string into `.env` in the project root (create it from `.env.example` if needed):
   ```
   PUBLISH_DATABASE_URL=postgresql://neondb_owner:xxxxx@ep-...neon.tech/neondb?sslmode=require
   ```
   `.env` is in `.gitignore`, so it is never committed.
2. Restart the backend so it sees the variable, then publish:
   ```bash
   docker compose up -d backend
   make publish
   ```
   This creates the tables in Neon and copies the data, the evaluation and the current model. It takes under a minute and prints row counts and the published model version.

## 3b. Create limited database users (security)

Render and GitHub Actions should not use the owner password. If one of their credentials ever leaked, the damage would then be limited:

| User | Used by | Allowed to |
|---|---|---|
| `neondb_owner` | your laptop (`make publish`) | everything |
| `gridcast_writer` | GitHub Actions daily job | add demand, weather and forecasts. **Can't** change the model, delete rows or drop tables |
| `gridcast_api` | Render API | **read only**; every query stops after 10 s |

1. Open [`infra/neon/roles.sql`](../infra/neon/roles.sql) and replace the two `CHANGE-ME-…` passwords with long random ones. To generate one, run `openssl rand -base64 24 | tr -d '/+='`. Don't commit the file with real passwords.
2. Neon console → your project → **SQL Editor**. Paste the whole file and click **Run**. Run it **after** step 3, because it grants access to the tables `make publish` created.
3. Build two connection strings from the owner string by swapping the user name and password:
   ```
   postgresql://gridcast_api:API-PASSWORD@ep-...neon.tech/neondb?sslmode=require      ← for Render
   postgresql://gridcast_writer:WRITER-PASSWORD@ep-...neon.tech/neondb?sslmode=require ← for GitHub
   ```
   Keep `?sslmode=require`: it encrypts the connection.

Create the users with the SQL above, not with Neon's "Roles" page: users created there get administrator rights.

## 4. Deploy the API (Render)

1. Render dashboard → **New → Blueprint** → connect your GitHub repository. Render finds `render.yaml` and proposes a web service called `gridcast-api`.
2. Fill in the two secret values it asks for:
   - `DATABASE_URL`: the **`gridcast_api`** (read-only) connection string from step 3b.
   - `CORS_ORIGINS`: for now `http://localhost:5173`. You'll replace it with the Vercel URL in step 6.
3. Click **Apply**. The first build takes about 5–8 minutes.
4. Check it: open `https://gridcast-api-XXXX.onrender.com/api/health`. It should show `{"status":"ok"}`. Also try `/api/docs` (interactive API docs) and `/api/kpis`.

> Prefer clicking through the UI instead of a Blueprint? Create a **Web Service** from the repo, set *Language* = Docker, *Dockerfile path* = `./backend/Dockerfile`, *Docker build context* = `./backend`, *Health check path* = `/api/health`, instance type **Free**, and add the same environment variables plus `MLFLOW_PUBLIC_URL` with an empty value.

## 5. Deploy the website (Vercel)

1. Vercel dashboard → **Add New → Project** → import the GitHub repository.
2. Set **Root Directory** to `frontend`. Vercel then detects Vite; `frontend/vercel.json` sets the build and the routing.
3. Under **Environment Variables** add:

   | Name | Value |
   |---|---|
   | `VITE_API_URL` | your Render URL, e.g. `https://gridcast-api-xxxx.onrender.com` (no trailing slash, no `/api`) |
   | `VITE_GITHUB_URL` | `https://github.com/YOUR-USERNAME/gridcast` (shows "Source code" buttons) |
   | `VITE_LINKEDIN_URL` | your LinkedIn profile URL (optional) |
   | `VITE_AUTHOR_NAME` | your name as it should appear (optional; defaults to Damian Glejzer) |

4. Click **Deploy**. Note the URL, e.g. `https://gridcast.vercel.app`. You can rename the project to get a nicer subdomain.

`VITE_*` variables are built into the site, so after changing one, redeploy (Deployments → ⋯ → Redeploy).

## 6. Connect the website and the API (CORS)

Browsers only let the website call the API if the API allows its address.

1. Render → `gridcast-api` → **Environment** → set `CORS_ORIGINS` to your Vercel URL, e.g.
   ```
   https://gridcast.vercel.app
   ```
   Add more addresses comma-separated if needed (for example a custom domain).
2. Save; Render redeploys automatically (~1 min).
3. Open the Vercel URL. The first visit may show "Waking up the server" for up to a minute; then all pages load.

## 7. Turn on the daily forecast (GitHub Actions)

1. GitHub repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `DATABASE_URL`
   - Value: the **`gridcast_writer`** connection string from step 3b.
2. **Actions** tab → enable workflows if GitHub asks.
3. Open **Daily forecast** → **Run workflow** to test it now. A green run means new data was downloaded and tomorrow's forecast written. It then runs automatically at 08:45 and 13:30 UTC every day.
4. **CI** runs on every push (tests, frontend build, Docker image). Its badge in the README turns green.

GitHub pauses scheduled workflows in repositories with **no activity for 60 days**. If that happens, re-enable the workflow in the Actions tab or push any small commit.

## 8. (Recommended) Keep the API awake

So recruiters don't wait for Render to wake up:

1. Create a free account at [UptimeRobot](https://uptimerobot.com).
2. **Add New Monitor** → type *HTTP(s)*, URL `https://gridcast-api-xxxx.onrender.com/api/health`, interval **10 minutes**.

This also gives you an uptime history and an email if the API goes down. Render's free plan includes 750 instance-hours per month, enough for one always-on service.

## 9. Final touches

- In `README.md`, replace `YOUR-USERNAME` and `YOUR-APP` with the real values and commit. The badges and the demo link then work.
- Add the live URL to the GitHub repository's **About** box and to your CV / LinkedIn.

---

## Releasing a new model later

Training never happens in production. When you want a new model:

```bash
make refresh && make train    # trains locally; compare the new run with the old one in MLflow
make publish                  # if it's better: promote it (the daily job uses it from tomorrow on)
```

`publish` is safe to repeat:

- The test-period evaluation is replaced with the new model's.
- Live forecasts already stored in Neon are kept, so the public track record stays honest.
- Only the newly published model is kept in the public database.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Website shows "Something went wrong · Failed to fetch" | `VITE_API_URL` is wrong (check it has `https://` and no trailing `/`), or `CORS_ORIGINS` on Render doesn't exactly match the Vercel URL. Redeploy Vercel after changing `VITE_API_URL`. |
| Website stuck on "Waking up the server" for over 2 minutes | Check the Render logs; most often `DATABASE_URL` is wrong. |
| `/api/kpis` works but charts are empty | `make publish` wasn't run, or ran against a different database. |
| Daily forecast job fails with a connection error | The `DATABASE_URL` secret is missing or mistyped. |
| Daily forecast job says "Weather forecast missing" | Open-Meteo was briefly unavailable; the 13:30 run usually fixes it, or run the workflow manually. |
| "No model deployed yet" | Run `make train` locally, then `make publish`. |
| Render logs show `permission denied` or `read-only transaction` | Expected if something tries to write: the API user is read-only. If pages fail, check that `MANAGE_SCHEMA=false` is set on Render and that `roles.sql` ran after the first publish. |
| Daily job fails with `permission denied for table …` | `roles.sql` hasn't been run yet, or it ran before the first `make publish`. Run it (again) in the Neon SQL editor. |
| You see "Too many requests" while testing | The API limits each visitor to 120 requests and 30 what-if scenarios per minute. Wait a minute. |
