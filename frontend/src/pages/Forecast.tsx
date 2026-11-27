import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Gauge, Target, TrendingUp } from "lucide-react";
import { useState } from "react";

import { DemandChart, DemandLegend } from "../components/DemandChart";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Explainer,
  PageHeader,
  Skeleton,
  Spinner,
  StatCard,
  Term,
  TERMS,
} from "../components/ui";
import { api, type DayInfo, type Kpis, type Series } from "../lib/api";
import { addDays, dayLabel, gw, hhmm, num, pct, relativeTime, ymd } from "../lib/format";

function KpiRow({ k }: { k: Kpis }) {
  const peak = k.tomorrow_peak;
  const acc = k.accuracy_30d;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={<TrendingUp size={17} />}
        label={`Peak · ${dayLabel(k.forecast_day)}`}
        value={peak ? gw(peak.value) : "–"}
        sub={
          peak ? (
            <>
              expected at <b className="text-ink">{hhmm(peak.ts)}</b>
              {peak.pse_value != null && <> · official forecast {gw(peak.pse_value)}</>}
            </>
          ) : (
            "No forecast available yet"
          )
        }
      />
      <StatCard
        icon={<Gauge size={17} />}
        label="Energy over the day"
        value={peak ? `${num(peak.energy_gwh, 0)} GWh` : "–"}
        sub={
          <>
            Total <Term tip={TERMS.gwh}>energy</Term> the whole country is expected to use that day
          </>
        }
      />
      <StatCard
        icon={<Target size={17} />}
        label="Error · last 30 days"
        value={acc ? pct(acc.model) : "–"}
        sub={
          acc ? (
            <>
              <Term tip={TERMS.mape}>MAPE</Term> · official forecast {pct(acc.pse)}
            </>
          ) : (
            "Not enough days yet"
          )
        }
      />
      <StatCard
        icon={<Clock size={17} />}
        label="Last data update"
        value={relativeTime(k.last_refresh)}
        sub={
          <>
            Measured demand until{" "}
            {k.actuals_until ? `${dayLabel(ymd(k.actuals_until), false)}, ${hhmm(k.actuals_until)}` : "–"}
          </>
        }
      />
    </div>
  );
}

const KIND_LABEL: Record<string, { label: string; tone: "accent" | "good" | "neutral"; tip: string }> = {
  forecast: {
    label: "Live forecast",
    tone: "accent",
    tip: "Made by the deployed model the day before, exactly as it would be used in practice.",
  },
  backtest: {
    label: "Test period",
    tone: "good",
    tip: "Predicted by a model that was not allowed to learn from this period: a fair exam.",
  },
  insample: {
    label: "Training period",
    tone: "neutral",
    tip: "The model learned from these days, so its fit here looks better than it really is.",
  },
};

function DayStats({ s, day }: { s: Series; day: DayInfo }) {
  const pts = s.points.filter((p) => ymd(p.ts) === day.date);
  const full = pts.filter((p) => p.actual != null && p.model != null && p.pse != null);
  const complete = full.length >= 92;
  const mape = (k: "model" | "pse") =>
    (full.reduce((a, p) => a + Math.abs((p[k]! - p.actual!) / p.actual!), 0) / full.length) * 100;
  const peakOf = (k: "actual" | "model" | "pse") => {
    const vals = pts.filter((p) => p[k] != null);
    if (!vals.length) return null;
    return vals.reduce((m, p) => (p[k]! > m[k]! ? p : m));
  };
  const rows: [string, "actual" | "model" | "pse", string][] = [
    ["Actual", "actual", "bg-ink"],
    ["Model", "model", "bg-series-model"],
    ["Official", "pse", "bg-series-pse"],
  ];
  const kind = day.model_kind ? KIND_LABEL[day.model_kind] : null;
  const winner = complete ? (mape("model") <= mape("pse") ? "model" : "pse") : null;
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold">{dayLabel(day.date)}</div>
        <div className="flex flex-wrap gap-1.5">
          {day.holiday && <Badge tone="bad">{day.holiday}</Badge>}
          {day.day_type === "weekend" && <Badge>Weekend</Badge>}
          {kind && (
            <span title={kind.tip}>
              <Badge tone={kind.tone}>{kind.label}</Badge>
            </span>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
        {rows.map(([label, key, dot]) => {
          const p = peakOf(key);
          return (
            <div key={key}>
              <dt className="flex items-center gap-1.5 whitespace-nowrap text-muted">
                <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} /> {label} peak
              </dt>
              <dd className="tnum mt-0.5 font-medium">
                {p ? gw(p[key]) : "–"}
                {p && <span className="block text-[12px] font-normal text-muted">at {hhmm(p.ts)}</span>}
              </dd>
            </div>
          );
        })}
      </dl>
      {complete ? (
        <div className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">
          Average miss: model <b className="tnum text-ink">{pct(mape("model"))}</b> · official{" "}
          <b className="tnum text-ink">{pct(mape("pse"))}</b>
          {winner === "model" && <span className="ml-2 text-good">✓ closer</span>}
        </div>
      ) : (
        <div className="mt-3 border-t border-line pt-3 text-[13px] text-muted">
          The day is not over yet, so it can't be scored.
        </div>
      )}
    </div>
  );
}

export default function Forecast() {
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  const [start, setStart] = useState<string | null>(null);
  const [showBaseline, setShowBaseline] = useState(false);
  const defaultStart = kpis.data ? addDays(kpis.data.forecast_day, -1) : undefined;
  const from = start ?? defaultStart;
  const series = useQuery({
    queryKey: ["series", from],
    queryFn: () => api.series(from!, 2),
    enabled: !!from,
    placeholderData: (prev) => prev,
  });

  if (kpis.isError) return <ErrorState error={kpis.error} onRetry={() => kpis.refetch()} />;

  const minDate = kpis.data?.first_day ?? undefined;
  const maxDate = defaultStart;
  const isDefault = from === defaultStart;

  return (
    <>
      <PageHeader
        eyebrow="Forecast explorer"
        title="Predicted vs actual electricity demand"
        description="Pick any two days since mid-2024 and compare the model's day-ahead forecast with what actually happened and with the official forecast."
      />
      {kpis.data ? (
        <KpiRow k={kpis.data} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[132px]" />
          ))}
        </div>
      )}

      <Card
        className="mt-6"
        title={from ? `${dayLabel(from)} – ${dayLabel(addDays(from, 1))}` : "Loading…"}
        subtitle="Demand in gigawatts (GW) · hover the chart for exact values"
        action={
          <div className="flex flex-wrap items-center gap-2">
            {series.isFetching && <Spinner />}
            <button
              className="btn-ghost h-9 w-9 !px-0"
              aria-label="Previous day"
              disabled={!from || from <= (minDate ?? "")}
              onClick={() => setStart(addDays(from!, -1))}
            >
              <ChevronLeft size={16} />
            </button>
            <label className="btn-ghost relative h-9 cursor-pointer !py-0">
              <CalendarDays size={15} className="text-muted" />
              <input
                type="date"
                aria-label="Pick start date"
                className="tnum bg-transparent text-[13px] outline-none [color-scheme:inherit]"
                value={from ?? ""}
                min={minDate}
                max={maxDate}
                onChange={(e) => e.target.value && setStart(e.target.value)}
              />
            </label>
            <button
              className="btn-ghost h-9 w-9 !px-0"
              aria-label="Next day"
              disabled={!from || !maxDate || from >= maxDate}
              onClick={() => setStart(addDays(from!, 1))}
            >
              <ChevronRight size={16} />
            </button>
            {!isDefault && (
              <button className="btn-ghost h-9" onClick={() => setStart(null)}>
                Latest
              </button>
            )}
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <DemandLegend showBaseline={showBaseline} />
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input
              type="checkbox"
              className="accent-[rgb(var(--accent))]"
              checked={showBaseline}
              onChange={(e) => setShowBaseline(e.target.checked)}
            />
            Show <Term tip={TERMS.naive}>naive guess</Term>
          </label>
        </div>
        {series.isError ? (
          <ErrorState error={series.error} onRetry={() => series.refetch()} />
        ) : !series.data ? (
          <Skeleton className="h-[420px] w-full" />
        ) : series.data.points.length === 0 ? (
          <EmptyState title="No data for these days" description="Pick another date." />
        ) : (
          <>
            <DemandChart
              series={series.data}
              actualsUntil={kpis.data?.actuals_until}
              height={420}
              showBaseline={showBaseline}
            />
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {series.data.days.map((d) => (
                <DayStats key={d.date} s={series.data!} day={d} />
              ))}
            </div>
          </>
        )}
        <Explainer>
          <p>
            Each point is the average demand of the whole Polish power system during one 15-minute interval,
            in gigawatts (1 GW = 1,000 <Term tip={TERMS.mw}>MW</Term>). A typical day ranges from about 13 GW
            at night to 20–25 GW at the evening peak.
          </p>
          <p>
            The labels on each day tell you how honest the comparison is: a{" "}
            <b className="text-ink">live forecast</b> was made the day before by the deployed model; the{" "}
            <b className="text-ink">test period</b> was predicted by a model that never saw those days; the{" "}
            <b className="text-ink">training period</b> is data the model learned from, so it naturally fits
            well there.
          </p>
        </Explainer>
      </Card>
    </>
  );
}
