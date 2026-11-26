import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  Brain,
  CalendarClock,
  CloudSun,
  Coins,
  Cpu,
  Database,
  FlaskConical,
  Github,
  LineChart,
  SlidersHorizontal,
  Target,
  Trophy,
  ZapOff,
} from "lucide-react";
import { Link } from "react-router-dom";

import { DemandChart, DemandLegend } from "../components/DemandChart";
import {
  Badge,
  Callout,
  Card,
  ErrorState,
  Explainer,
  Skeleton,
  StatCard,
  Term,
  TERMS,
} from "../components/ui";
import { SITE } from "../config";
import { api } from "../lib/api";
import { addDays, dayLabel, gw, hhmm, num, pct } from "../lib/format";

function yearsBetween(a?: string | null, b?: string | null) {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 86400_000);
}

const STEPS = [
  {
    icon: Database,
    title: "Collect",
    body: "Every day, fresh demand data from the grid operator and weather forecasts for 8 Polish cities are downloaded and checked.",
  },
  {
    icon: Brain,
    title: "Learn",
    body: "A gradient-boosted tree model (LightGBM) learns how demand depends on the time, the calendar, recent demand and the weather.",
  },
  {
    icon: Target,
    title: "Test",
    body: "Before going live, the model is scored on the most recent 60 days, which it never saw during training, against the official forecast.",
  },
  {
    icon: CalendarClock,
    title: "Forecast daily",
    body: "An automated job predicts tomorrow's demand every morning, 96 values per day, and keeps every forecast to track real-world accuracy.",
  },
];

const EXPLORE = [
  {
    to: "/forecast",
    icon: LineChart,
    title: "Forecast",
    body: "Browse any day: what the model predicted vs what really happened.",
  },
  {
    to: "/accuracy",
    icon: Target,
    title: "Accuracy",
    body: "How often and by how much the model misses, compared with the official forecast.",
  },
  {
    to: "/what-if",
    icon: SlidersHorizontal,
    title: "What-if",
    body: "Make tomorrow colder or turn it into a holiday and watch the forecast react.",
  },
  {
    to: "/how-it-works",
    icon: BookOpen,
    title: "How it works",
    body: "The data, the model and the MLOps pipeline behind it, explained with charts.",
  },
  {
    to: "/model",
    icon: Cpu,
    title: "Model card",
    body: "Version, training data, test results and settings of the deployed model.",
  },
];

const STACK: [string, string[]][] = [
  ["Machine learning", ["LightGBM", "SHAP", "pandas", "Pandera"]],
  ["MLOps", ["MLflow", "Docker", "GitHub Actions", "pytest"]],
  ["Backend", ["Python", "FastAPI", "PostgreSQL", "SQLAlchemy"]],
  ["Frontend", ["React", "TypeScript", "Tailwind", "ECharts"]],
  ["Cloud", ["Render", "Vercel", "Neon"]],
];

export default function Overview() {
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  const model = useQuery({ queryKey: ["model"], queryFn: api.model });
  const record = useQuery({ queryKey: ["track-record"], queryFn: api.trackRecord });
  const focus = kpis.data?.forecast_day;
  const start = focus ? addDays(focus, -1) : undefined;
  const series = useQuery({
    queryKey: ["series", start],
    queryFn: () => api.series(start!, 2),
    enabled: !!start,
  });

  const m = model.data?.current?.metrics;
  const gain = m ? ((m.pse_mape - m.model_mape) / m.pse_mape) * 100 : null;
  const naiveGain = m ? ((m.baseline_mape - m.model_mape) / m.baseline_mape) * 100 : null;
  const beatsPse = gain != null && gain > 0;
  const run = model.data?.current;
  const testDays = run
    ? Math.round((new Date(run.test_end).getTime() - new Date(run.test_start).getTime()) / 86400_000) + 1
    : 60;
  const years = yearsBetween(kpis.data?.first_day, kpis.data?.last_day);
  const peak = kpis.data?.tomorrow_peak;
  const stale = kpis.data && focus !== kpis.data.tomorrow;
  const live = record.data?.available ? record.data : null;

  return (
    <div className="space-y-10">
      {/* Hero: the pitch on the left, the live forecast on the right */}
      <section className="grid animate-fade-in items-start gap-8 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="xl:pt-2">
          <div className="eyebrow mb-3 text-accent">Machine learning engineering · portfolio project</div>
          <h1 className="text-[32px] font-semibold leading-[1.12] tracking-tight sm:text-[40px]">
            Forecasting how much electricity Poland will use tomorrow
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            Every day the grid operator <Term tip={TERMS.pse}>PSE</Term> predicts the next day's demand, every
            15 minutes, so the country can prepare its power plants to produce the right amount of energy.
          </p>
          <ul className="mt-4 space-y-2 text-[14px]">
            <li className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-series-pse/12 text-series-pse">
                <Coins size={15} />
              </span>
              <span className="text-ink-2">
                <b className="text-ink">Too much energy</b> is wasted money
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-bad/12 text-bad">
                <ZapOff size={15} />
              </span>
              <span className="text-ink-2">
                <b className="text-ink">Too little energy</b> means shortages
              </span>
            </li>
          </ul>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            <b className="text-ink">{SITE.name}</b> is an end-to-end machine-learning system that makes the
            same forecast automatically every day
            {beatsPse ? (
              <>
                {" "}
                and, on data it has never seen, is{" "}
                <b className="text-ink">more accurate than the official one</b>.
              </>
            ) : (
              <> and scores itself against the official one.</>
            )}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/forecast" className="btn-primary !px-4 !py-2.5">
              Explore the forecast <ArrowRight size={16} />
            </Link>
            <Link to="/how-it-works" className="btn-ghost !px-4 !py-2.5">
              How it works
            </Link>
            {SITE.githubUrl && (
              <a href={SITE.githubUrl} target="_blank" rel="noreferrer" className="btn-ghost !px-4 !py-2.5">
                <Github size={16} /> Source code
              </a>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <Card
            className="h-full"
            title={
              focus ? (
                <span className="flex flex-wrap items-center gap-2">
                  {stale
                    ? `Latest forecast: ${dayLabel(focus)}`
                    : `Today and the forecast for ${dayLabel(focus)}`}
                  {stale && <Badge>updates every morning</Badge>}
                </span>
              ) : (
                "Today and tomorrow"
              )
            }
            subtitle={
              peak ? (
                <>
                  Expected peak <b className="tnum text-ink">{gw(peak.value)}</b> at {hhmm(peak.ts)} ·{" "}
                  {num(peak.energy_gwh, 0)} <Term tip={TERMS.gwh}>GWh</Term> over the day
                </>
              ) : (
                "National electricity demand, every 15 minutes"
              )
            }
          >
            <div className="-mt-2 mb-2">
              <DemandLegend />
            </div>
            {series.isError ? (
              <ErrorState error={series.error} onRetry={() => series.refetch()} />
            ) : !series.data ? (
              <Skeleton className="h-[330px] w-full" />
            ) : (
              <DemandChart series={series.data} actualsUntil={kpis.data?.actuals_until} height={330} />
            )}
            <Explainer>
              <p>
                The <b className="text-ink">black line</b> is how much electricity the whole of Poland
                actually used, in gigawatts. It stops at the latest measurement. The{" "}
                <b className="text-ink">blue line</b> is the GridCast model's prediction and the{" "}
                <b className="text-ink">orange line</b> is the official forecast by PSE. Both were made the
                day before.
              </p>
              <p>
                Demand follows people's routines: low at night, rising in the morning, a plateau during
                working hours and an evening peak. The closer a forecast hugs the black line, the better. The
                shaded area is tomorrow, which has not happened yet.
              </p>
            </Explainer>
          </Card>
        </div>
      </section>

      {/* Headline numbers */}
      <section aria-label="Headline results" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {m ? (
          <>
            <StatCard
              highlight
              icon={<Trophy size={17} />}
              label={
                <>
                  Average error (<Term tip={TERMS.mape}>MAPE</Term>)
                </>
              }
              value={pct(m.model_mape)}
              sub={
                <>
                  Official forecast: <b className="tnum text-ink">{pct(m.pse_mape)}</b> · naive guess{" "}
                  <span className="tnum">{pct(m.baseline_mape)}</span>
                </>
              }
            />
            <StatCard
              icon={<Target size={17} />}
              label={beatsPse ? "Fewer errors than PSE" : "Fewer errors than a naive guess"}
              value={beatsPse ? `${gain!.toFixed(0)}%` : `${naiveGain!.toFixed(0)}%`}
              sub={`Measured on ${testDays} recent days the model never saw while learning`}
            />
            <StatCard
              icon={<CalendarClock size={17} />}
              label="Forecasts per day"
              value="96"
              sub="One for every 15 minutes of the next day, made automatically each morning"
            />
            <StatCard
              icon={<Database size={17} />}
              label="Training history"
              value={years ? `${years.toFixed(1)} years` : "–"}
              sub={`${num(kpis.data?.rows)} demand measurements plus hourly weather`}
            />
          </>
        ) : model.isError ? (
          <div className="card sm:col-span-2 xl:col-span-4">
            <ErrorState error={model.error} onRetry={() => model.refetch()} />
          </div>
        ) : (
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[132px]" />)
        )}
      </section>

      {live && live.n_days >= 3 && (
        <Callout icon={<FlaskConical size={16} />} tone="good">
          <b className="text-ink">Live track record:</b> since {dayLabel(live.first_forecast!, false)}, the
          model's real day-ahead forecasts missed by{" "}
          <b className="tnum text-ink">{pct(live.summary.model.mape)}</b> on average, vs{" "}
          <b className="tnum text-ink">{pct(live.summary.pse.mape)}</b> for the official forecast (
          {live.n_days} days).{" "}
          <Link to="/accuracy" className="font-medium text-accent hover:underline">
            See details
          </Link>
        </Callout>
      )}

      {/* How it works strip */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight">How it works, in four steps</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="card relative p-5">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/12 text-accent">
                  <Icon size={18} />
                </div>
                <span className="eyebrow">Step {i + 1}</span>
              </div>
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
          <CloudSun size={15} className="text-muted" /> Inputs: time of day, weekday, public holidays, demand
          in previous days, and weather (temperature, clouds, sunshine, wind).
        </div>
      </section>

      {/* Explore */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight">Explore the project</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {EXPLORE.map(({ to, icon: Icon, title, body }) => (
            <Link
              key={to}
              to={to}
              className="card group p-5 transition hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg"
            >
              <Icon size={20} className="text-accent" />
              <h3 className="mt-3 flex items-center gap-1 font-semibold">
                {title}
                <ArrowRight
                  size={14}
                  className="opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                />
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Stack */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight">Built with</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {STACK.map(([group, items]) => (
            <div key={group}>
              <div className="eyebrow mb-2">{group}</div>
              <div className="flex flex-wrap gap-1.5">
                {items.map((t) => (
                  <span
                    key={t}
                    className="rounded-md border border-line bg-surface px-2 py-1 text-[12px] font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
