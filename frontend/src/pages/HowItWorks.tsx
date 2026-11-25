import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import {
  ArrowDown,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CloudSun,
  Database,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Globe,
  Laptop,
  Server,
  ShieldCheck,
  Timer,
  Upload,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

import { Chart } from "../components/Chart";
import { Card, Explainer, LegendDot, PageHeader, Skeleton, Term, TERMS } from "../components/ui";
import { api, type Insights, type ModelRun } from "../lib/api";
import { axisCommon, baseOption, tooltipRow } from "../lib/chart";
import { dayLabel, mw, num } from "../lib/format";
import { type ChartColors, useChartColors } from "../lib/theme";

type InsightsOk = Extract<Insights, { available: true }>;

const PROFILE_SERIES = [
  { key: "weekday", label: "Weekday", color: (c: ChartColors) => c.model },
  { key: "saturday", label: "Saturday", color: (c: ChartColors) => c.pse },
  { key: "sunday", label: "Sunday / holiday", color: (c: ChartColors) => c.base },
] as const;

function profileOption(d: InsightsOk, c: ChartColors): EChartsOption {
  const times = d.profile.map((p) => p.time);
  return {
    ...baseOption(c),
    tooltip: {
      ...(baseOption(c).tooltip as object),
      formatter: (params: unknown) => {
        const ps = params as { seriesIndex: number; value: number; dataIndex: number }[];
        return `<div style="font-weight:600;margin-bottom:4px">${times[ps[0].dataIndex]}</div>${ps
          .map((p) =>
            tooltipRow(
              PROFILE_SERIES[p.seriesIndex].color(c),
              PROFILE_SERIES[p.seriesIndex].label,
              mw(p.value),
            ),
          )
          .join("")}`;
      },
    },
    xAxis: {
      type: "category",
      data: times,
      boundaryGap: false,
      ...axisCommon(c),
      splitLine: { show: false },
      axisLabel: {
        color: c.muted,
        fontSize: 11,
        interval: (_: number, v: string) => v.endsWith(":00") && Number(v.slice(0, 2)) % 3 === 0,
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)} GW` },
    },
    series: PROFILE_SERIES.map((s) => ({
      name: s.label,
      type: "line",
      smooth: 0.3,
      showSymbol: false,
      symbolSize: 8,
      data: d.profile.map((p) => p[s.key] ?? null),
      lineStyle: { width: 2.5, color: s.color(c) },
      itemStyle: { color: s.color(c) },
    })),
  };
}

function scatterOption(d: InsightsOk, c: ChartColors): EChartsOption {
  const groups = [
    { name: "Working days", color: c.model, rows: d.temperature.filter((r) => r.day_type === "weekday") },
    {
      name: "Weekends & holidays",
      color: c.pse,
      rows: d.temperature.filter((r) => r.day_type !== "weekday"),
    },
  ];
  return {
    ...baseOption(c),
    grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      trigger: "item",
      formatter: (p: unknown) => {
        const { seriesIndex, dataIndex } = p as { seriesIndex: number; dataIndex: number };
        const r = groups[seriesIndex].rows[dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${dayLabel(r.date)} ${r.date.slice(0, 4)}</div>
          ${tooltipRow(groups[seriesIndex].color, "Average demand", mw(r.demand))}
          ${tooltipRow("transparent", "Mean temperature", `${num(r.temperature, 1)} °C`)}`;
      },
    },
    xAxis: {
      type: "value",
      name: "Average daily temperature (°C)",
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: c.muted, fontSize: 11 },
      ...axisCommon(c),
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)} GW` },
    },
    series: groups.map((g) => ({
      name: g.name,
      type: "scatter",
      symbolSize: 6,
      data: g.rows.map((r) => [r.temperature, r.demand]),
      itemStyle: { color: g.color, opacity: 0.75 },
    })),
  };
}

function Section({
  n,
  title,
  lead,
  children,
}: {
  n: number;
  title: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <div>
        <div className="eyebrow text-accent">Part {n}</div>
        <h2 className="mt-2 text-xl font-semibold tracking-tight">{title}</h2>
        <div className="mt-2 space-y-2 text-[14px] leading-relaxed text-ink-2">{lead}</div>
      </div>
      <div className="min-w-0 space-y-6">{children}</div>
    </section>
  );
}

function Timeline({ run }: { run: ModelRun }) {
  const t = (d: string) => new Date(d).getTime();
  const validStart = t(run.test_start) - 30 * 86400_000;
  const total = t(run.test_end) - t(run.train_start);
  const parts = [
    { label: "Learning", from: run.train_start, w: validStart - t(run.train_start), cls: "bg-accent/70" },
    { label: "Tuning", from: null, w: t(run.test_start) - validStart, cls: "bg-series-base/80" },
    {
      label: "Exam",
      from: run.test_start,
      w: t(run.test_end) - t(run.test_start) + 86400_000,
      cls: "bg-series-pse/85",
    },
  ];
  return (
    <div>
      <div className="flex h-11 overflow-hidden rounded-xl text-[12px] font-semibold text-white">
        {parts.map((p) => (
          <div
            key={p.label}
            className={`grid place-items-center ${p.cls}`}
            style={{ width: `${(p.w / total) * 100}%` }}
            title={p.label}
          >
            {p.w / total > 0.08 && <span className="truncate px-1">{p.label}</span>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-muted">
        <span>
          {dayLabel(run.train_start, false)} {run.train_start.slice(0, 4)}
        </span>
        <span>
          {dayLabel(run.test_end, false)} {run.test_end.slice(0, 4)}
        </span>
      </div>
      <dl className="mt-5 grid gap-4 text-[13px] sm:grid-cols-3">
        <div>
          <dt className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent/70" /> Learning
          </dt>
          <dd className="mt-1 text-ink-2">
            The model studies {num(run.n_train)} past 15-minute slots and the answers.
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm bg-series-base/80" /> Tuning (30 days)
          </dt>
          <dd className="mt-1 text-ink-2">
            Decides when to stop learning, so the model doesn't memorise noise.
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-sm bg-series-pse/85" /> Exam (
            {Math.round((t(run.test_end) - t(run.test_start)) / 86400_000) + 1} days)
          </dt>
          <dd className="mt-1 text-ink-2">
            Never seen while learning. All accuracy numbers on this site come from here and from live
            forecasts.
          </dd>
        </div>
      </dl>
    </div>
  );
}

const FEATURE_GROUPS = [
  {
    icon: CalendarDays,
    title: "Calendar",
    items: [
      "Time of day (every 15 min)",
      "Day of the week",
      "Public holidays & bridge days",
      "Christmas period",
      "Month and season",
    ],
  },
  {
    icon: Zap,
    title: "Recent demand",
    items: [
      "Same time 2, 7 and 14 days ago",
      "Average and peak demand 2 days ago",
      "Average demand a week ago",
    ],
    note: "Always at least 48 hours old, exactly what would be known on the morning before.",
  },
  {
    icon: CloudSun,
    title: "Weather forecast",
    items: ["Temperature", "Cloud cover", "Solar radiation", "Wind speed", "Heating and cooling need"],
    note: "Averaged over 8 large cities, weighted by population.",
  },
];

function Node({
  icon,
  title,
  body,
  tone = "neutral",
}: {
  icon: ReactNode;
  title: string;
  body: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <div
      className={`rounded-xl border p-3.5 ${tone === "accent" ? "border-accent/40 bg-accent/[0.07]" : "border-line bg-surface"}`}
    >
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-2">{body}</p>
    </div>
  );
}

function Flow({ children }: { children: ReactNode[] }) {
  return (
    <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
      {children.map((child, i) => (
        <div key={i} className="contents">
          <div className="md:flex-1">{child}</div>
          {i < children.length - 1 && (
            <div className="grid place-items-center text-muted">
              <ArrowRight size={16} className="hidden md:block" />
              <ArrowDown size={16} className="md:hidden" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Lifecycle() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-dashed border-line p-4">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <Laptop size={14} /> Offline · on the author's machine (Docker Compose)
        </div>
        <Flow>
          <Node
            icon={<Database size={15} />}
            title="1 · Collect"
            body="Download and validate demand and weather into PostgreSQL."
          />
          <Node
            icon={<Boxes size={15} />}
            title="2 · Train"
            body="Build features, train LightGBM, evaluate on the exam period."
          />
          <Node
            icon={<FlaskConical size={15} />}
            title="3 · Track"
            body="Log parameters, metrics and the model to MLflow; register a version."
          />
          <Node
            icon={<Upload size={15} />}
            title="4 · Publish"
            body="Review the run, then promote the model and data to production."
            tone="accent"
          />
        </Flow>
      </div>
      <div className="flex justify-center text-muted">
        <ArrowDown size={18} />
      </div>
      <div className="rounded-2xl border border-accent/30 bg-accent/[0.03] p-4">
        <div className="eyebrow mb-3 flex items-center gap-2">
          <Globe size={14} /> Production · free cloud services
        </div>
        <Flow>
          <Node
            icon={<Timer size={15} />}
            title="Daily job · GitHub Actions"
            body="Every morning: fetch new data, forecast tomorrow with the published model."
          />
          <Node
            icon={<Database size={15} />}
            title="Database · Neon"
            body="PostgreSQL with data, forecasts, metrics and the model itself."
          />
          <Node
            icon={<Server size={15} />}
            title="API · Render"
            body="FastAPI service: serves results and runs the model live for What-if."
          />
          <Node
            icon={<Globe size={15} />}
            title="Website · Vercel"
            body="This React app, talking to the API over HTTPS."
          />
        </Flow>
      </div>
    </div>
  );
}

const QUALITY = [
  {
    icon: ShieldCheck,
    title: "No data leakage",
    body: "A unit test proves the model never sees information from the day it forecasts.",
  },
  {
    icon: CheckCircle2,
    title: "Validated data",
    body: "Every download is checked with Pandera (ranges, 15-minute grid, duplicates) before it is stored.",
  },
  {
    icon: GitBranch,
    title: "CI on every push",
    body: "GitHub Actions runs linting, 30+ backend tests and a production build of the frontend.",
  },
  {
    icon: FlaskConical,
    title: "Experiment tracking",
    body: "Every training run is logged and versioned in MLflow, so any result can be traced back.",
  },
  {
    icon: Timer,
    title: "Honest live record",
    body: "Forecasts are stored before each day starts and never overwritten afterwards.",
  },
  {
    icon: Boxes,
    title: "Reproducible",
    body: "Docker images, a locked dependency set and one-command setup (make up).",
  },
];

export default function HowItWorks() {
  const c = useChartColors();
  const insights = useQuery({ queryKey: ["insights"], queryFn: api.insights });
  const model = useQuery({ queryKey: ["model"], queryFn: api.model });
  const imp = useQuery({ queryKey: ["importance"], queryFn: api.importance, retry: false });
  const d = insights.data?.available ? insights.data : null;
  const run = model.data?.current;
  const groups = imp.data ? Object.entries(imp.data.groups).sort((a, b) => b[1] - a[1]) : [];
  const total = groups.reduce((a, [, v]) => a + v, 0);

  return (
    <div className="space-y-16">
      <PageHeader
        eyebrow="How it works"
        title="From raw data to a daily forecast"
        description="What the problem is, which data the model uses, how it learns and is tested, and how it runs in production, step by step."
      />

      <Section
        n={1}
        title="Electricity demand follows our routines"
        lead={
          <>
            <p>
              Electricity can't easily be stored, so power plants must produce exactly what the country uses,
              every moment. That's why the grid operator needs to know tomorrow's demand in advance.
            </p>
            <p>The good news: demand is very regular. People sleep, work and rest on a schedule.</p>
          </>
        }
      >
        <Card
          title="A typical day in Poland"
          subtitle="Average demand by time of day over the last year"
          action={
            <div className="flex flex-wrap gap-3">
              {PROFILE_SERIES.map((s) => (
                <LegendDot key={s.key} color={s.color(c)} label={s.label} />
              ))}
            </div>
          }
        >
          {d ? (
            <Chart ariaLabel="Average daily demand profile" option={profileOption(d, c)} height={300} />
          ) : (
            <Skeleton className="h-[300px]" />
          )}
          <Explainer title="What does this show?">
            <p>
              Demand drops to its lowest around 3–4 am, rises quickly when people wake up and businesses open,
              and peaks in the late afternoon and evening. On weekends and holidays the whole curve is lower
              and the morning rise starts later, because factories and offices are closed.
            </p>
          </Explainer>
        </Card>
        <Card
          title="Colder days need more electricity"
          subtitle="Each dot is one day: its average temperature and average demand"
        >
          {d ? (
            <Chart ariaLabel="Daily demand vs temperature" option={scatterOption(d, c)} height={320} />
          ) : (
            <Skeleton className="h-[320px]" />
          )}
          <div className="mt-2 flex flex-wrap gap-4">
            <LegendDot color={c.model} label="Working days" />
            <LegendDot color={c.pse} label="Weekends & holidays" />
          </div>
          <Explainer title="What does this show?">
            <p>
              The colder it is, the higher the demand: heating, lighting and longer evenings. The two clouds
              of dots also show the weekly pattern again: weekends sit clearly lower than working days at the
              same temperature. The model learns both effects at once.
            </p>
          </Explainer>
        </Card>
      </Section>

      <Section
        n={2}
        title="The data"
        lead={
          <p>
            Everything comes from free, public sources and is updated automatically every morning. Each
            download is validated before it is stored.
          </p>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Zap,
              name: "PSE (grid operator)",
              url: "https://api.raporty.pse.pl",
              body: "Actual national demand and the official day-ahead forecast, every 15 minutes, since June 2024.",
            },
            {
              icon: CloudSun,
              name: "Open-Meteo",
              url: "https://open-meteo.com",
              body: "Hourly weather forecasts for 8 large Polish cities: temperature, clouds, sunshine and wind.",
            },
            {
              icon: CalendarDays,
              name: "Polish calendar",
              url: "https://pypi.org/project/holidays/",
              body: "Public holidays, plus derived bridge days and the Christmas period.",
            },
          ].map(({ icon: Icon, name, url, body }) => (
            <div key={name} className="card p-5">
              <Icon size={20} className="text-accent" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 flex items-center gap-1 font-semibold hover:text-accent"
              >
                {name} <ExternalLink size={12} className="text-muted" />
              </a>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>
        {d && (
          <p className="text-[13px] text-ink-2">
            In total: <b className="tnum text-ink">{num(d.coverage.rows)}</b> 15-minute demand measurements
            from {dayLabel(d.coverage.first_day, false)} {d.coverage.first_day.slice(0, 4)} until today.
          </p>
        )}
      </Section>

      <Section
        n={3}
        title="What the model looks at"
        lead={
          <>
            <p>
              For each 15-minute slot of tomorrow, the model gets 25 clues and answers with one number: the
              expected demand in <Term tip={TERMS.mw}>MW</Term>.
            </p>
            <p>
              The model is <b className="text-ink">LightGBM</b>, an ensemble of about a thousand small
              decision trees. Each tree corrects the mistakes of the previous ones.
            </p>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {FEATURE_GROUPS.map(({ icon: Icon, title, items, note }) => {
            const share = groups.find(
              ([g]) => g.toLowerCase() === title.toLowerCase().replace(" forecast", ""),
            );
            return (
              <div key={title} className="card flex flex-col p-5">
                <div className="flex items-center justify-between">
                  <Icon size={20} className="text-accent" />
                  {share && total > 0 && (
                    <span className="tnum rounded-full bg-accent/12 px-2 py-0.5 text-[12px] font-semibold text-accent">
                      {((share[1] / total) * 100).toFixed(0)}% of influence
                    </span>
                  )}
                </div>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <ul className="mt-2 space-y-1 text-[13px] text-ink-2">
                  {items.map((i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
                      {i}
                    </li>
                  ))}
                </ul>
                {note && <p className="mt-auto pt-3 text-[12px] text-muted">{note}</p>}
              </div>
            );
          })}
        </div>
        <p className="text-[13px] text-ink-2">
          The official forecast is <b className="text-ink">never</b> given to the model: it is only used to
          compare against. Influence shares are measured with <Term tip={TERMS.shap}>SHAP values</Term>.
        </p>
      </Section>

      <Section
        n={4}
        title="How it learns, and how it is tested"
        lead={
          <p>
            History is split by time. The model learns from the older part and is graded on the most recent
            weeks, like an exam with questions it has never seen. Only then is it retrained on everything and
            deployed.
          </p>
        }
      >
        <Card title="Training timeline of the deployed model">
          {run ? <Timeline run={run} /> : <Skeleton className="h-[140px]" />}
        </Card>
      </Section>

      <Section
        n={5}
        title="Running it in production (MLOps)"
        lead={
          <>
            <p>
              Training is done offline and reviewed by a human. Only an approved model is published; after
              that, everything runs on its own.
            </p>
            <p>
              The public website can't retrain the model, so visitors always see the same, reviewed version.
            </p>
          </>
        }
      >
        <Card title="Model lifecycle">
          <Lifecycle />
        </Card>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {QUALITY.map(({ icon: Icon, title, body }) => (
            <div key={title} className="card p-4">
              <div className="flex items-center gap-2 font-semibold">
                <Icon size={16} className="text-good" /> {title}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
