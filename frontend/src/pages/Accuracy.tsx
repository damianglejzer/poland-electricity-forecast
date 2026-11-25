import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import { Radio, Ruler } from "lucide-react";
import { useState } from "react";

import { Chart } from "../components/Chart";
import {
  Callout,
  Card,
  EmptyState,
  ErrorState,
  Explainer,
  LegendDot,
  PageHeader,
  Segmented,
  Skeleton,
  Term,
  TERMS,
} from "../components/ui";
import { api, type Benchmark as BenchmarkData, type SourceKey } from "../lib/api";
import { axisCommon, baseOption, tooltipRow } from "../lib/chart";
import { dayLabel, num, pct } from "../lib/format";
import { type ChartColors, useChartColors } from "../lib/theme";

const SOURCES: { key: SourceKey; label: string; dashed?: boolean }[] = [
  { key: "model", label: "My model" },
  { key: "pse", label: "Official forecast (PSE)" },
  { key: "baseline", label: "Naive guess (last week)", dashed: true },
];
const color = (c: ChartColors, k: SourceKey) => (k === "model" ? c.model : k === "pse" ? c.pse : c.base);

type Ok = Extract<BenchmarkData, { available: true }>;

function tooltipFor(c: ChartColors, title: (i: number) => string) {
  return {
    ...(baseOption(c).tooltip as object),
    formatter: (params: unknown) => {
      const ps = params as { seriesName: string; value: number; dataIndex: number; seriesIndex: number }[];
      const rows = ps
        .map((p) => {
          const s = SOURCES[p.seriesIndex];
          return tooltipRow(color(c, s.key), s.label, pct(p.value), s.dashed);
        })
        .join("");
      return `<div style="font-weight:600;margin-bottom:4px">${title(ps[0].dataIndex)}</div>${rows}`;
    },
  };
}

function dailyOption(b: Ok, c: ChartColors): EChartsOption {
  const dates = b.daily.map((d) => d.business_date);
  return {
    ...baseOption(c),
    tooltip: tooltipFor(c, (i) => dayLabel(dates[i])),
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      ...axisCommon(c),
      splitLine: { show: false },
      axisLabel: {
        color: c.muted,
        fontSize: 11,
        formatter: (v: string) => dayLabel(v, false),
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: "{value}%" },
    },
    series: SOURCES.map((s) => ({
      name: s.label,
      type: "line",
      data: b.daily.map((d) => d[s.key]),
      showSymbol: false,
      symbolSize: 8,
      lineStyle: { width: s.dashed ? 1.5 : 2, color: color(c, s.key), type: s.dashed ? "dashed" : "solid" },
      itemStyle: { color: color(c, s.key) },
      z: s.key === "model" ? 3 : 2,
    })),
  };
}

function hourOption(b: Ok, c: ChartColors): EChartsOption {
  return {
    ...baseOption(c),
    tooltip: tooltipFor(
      c,
      (i) =>
        `${String(b.by_hour[i].hour).padStart(2, "0")}:00 – ${String(b.by_hour[i].hour + 1).padStart(2, "0")}:00`,
    ),
    xAxis: {
      type: "category",
      data: b.by_hour.map((h) => String(h.hour).padStart(2, "0")),
      ...axisCommon(c),
      splitLine: { show: false },
      axisLabel: { color: c.muted, fontSize: 11, interval: 2 },
    },
    yAxis: {
      type: "value",
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: "{value}%" },
    },
    series: SOURCES.map((s) => ({
      name: s.label,
      type: "line",
      smooth: 0.2,
      data: b.by_hour.map((h) => h[s.key]),
      showSymbol: false,
      symbolSize: 8,
      lineStyle: { width: s.dashed ? 1.5 : 2, color: color(c, s.key), type: s.dashed ? "dashed" : "solid" },
      itemStyle: { color: color(c, s.key) },
    })),
  };
}

const DAY_TYPE_LABEL: Record<string, string> = {
  weekday: "Weekdays",
  weekend: "Weekends",
  holiday: "Holidays",
};

function dayTypeOption(b: Ok, c: ChartColors): EChartsOption {
  const cats = b.by_day_type.map(
    (d) => `${DAY_TYPE_LABEL[d.day_type]}\n${d.n_days} ${d.n_days === 1 ? "day" : "days"}`,
  );
  return {
    ...baseOption(c),
    tooltip: {
      ...tooltipFor(c, (i) => cats[i].replace("\n", " · ")),
      axisPointer: { type: "shadow", shadowStyle: { color: c.accentSoft } },
    },
    xAxis: {
      type: "category",
      data: cats,
      ...axisCommon(c),
      splitLine: { show: false },
      axisLabel: { color: c.muted, fontSize: 11, interval: 0, lineHeight: 16 },
    },
    yAxis: {
      type: "value",
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: "{value}%" },
    },
    series: SOURCES.map((s) => ({
      name: s.label,
      type: "bar",
      barMaxWidth: 28,
      barGap: "12%",
      data: b.by_day_type.map((d) => d[s.key]),
      itemStyle: { color: color(c, s.key), borderRadius: [4, 4, 0, 0] },
    })),
  };
}

function Legend() {
  const c = useChartColors();
  return (
    <div className="flex flex-wrap gap-4">
      {SOURCES.map((s) => (
        <LegendDot key={s.key} color={color(c, s.key)} dashed={s.dashed} label={s.label} />
      ))}
    </div>
  );
}

function SummaryTable({ b }: { b: Ok }) {
  const c = useChartColors();
  const best = (m: "mape" | "mae" | "rmse") => Math.min(...SOURCES.map((s) => b.summary[s.key][m]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] text-left text-[14px]">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="eyebrow py-2 pr-4 font-medium">Forecast</th>
            <th className="eyebrow py-2 pr-4 text-right font-medium">
              <Term tip={TERMS.mape}>MAPE</Term>
            </th>
            <th className="eyebrow py-2 pr-4 text-right font-medium">
              <Term tip={TERMS.mae}>MAE</Term>
            </th>
            <th className="eyebrow py-2 text-right font-medium">
              <Term tip={TERMS.rmse}>RMSE</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {SOURCES.map((s) => (
            <tr key={s.key} className="border-b border-line last:border-0">
              <td className="py-3 pr-4">
                <LegendDot color={color(c, s.key)} dashed={s.dashed} label={s.label} />
              </td>
              {(["mape", "mae", "rmse"] as const).map((m) => {
                const v = b.summary[s.key][m];
                return (
                  <td
                    key={m}
                    className={`tnum py-3 pr-4 text-right last:pr-0 ${v === best(m) ? "font-semibold text-ink" : "text-ink-2"}`}
                  >
                    {m === "mape" ? pct(v) : `${num(v)} MW`}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LiveRecord() {
  const c = useChartColors();
  const q = useQuery({ queryKey: ["track-record"], queryFn: api.trackRecord });
  if (!q.data) return <Skeleton className="h-[220px]" />;
  if (!q.data.available)
    return (
      <Callout icon={<Radio size={16} />} tone="neutral">
        <b className="text-ink">Live track record starts soon.</b> Every day the deployed model forecasts
        tomorrow, and the forecast is stored before the day begins. Once at least one full day has passed,
        this section compares those real forecasts with what happened.
      </Callout>
    );
  const b = q.data;
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Radio size={16} className="text-good" /> Live track record
        </span>
      }
      subtitle={`Real day-ahead forecasts since ${dayLabel(b.first_forecast!, false)} · ${b.n_days} ${
        b.n_days === 1 ? "day" : "days"
      } so far`}
      action={<Legend />}
    >
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <dl className="space-y-4">
          {SOURCES.map((s) => (
            <div key={s.key}>
              <dt className="text-[13px] text-ink-2">
                <LegendDot color={color(c, s.key)} dashed={s.dashed} label={s.label} />
              </dt>
              <dd className="tnum mt-1 text-2xl font-semibold">{pct(b.summary[s.key].mape)}</dd>
            </div>
          ))}
        </dl>
        {b.n_days >= 2 ? (
          <Chart ariaLabel="Daily error of live forecasts" option={dailyOption(b, c)} height={240} />
        ) : (
          <div className="grid place-items-center text-[13px] text-muted">
            The chart appears after two days.
          </div>
        )}
      </div>
      <Explainer title="Why does this matter?">
        <p>
          The test results above are measured once, when the model is trained. This record is different: these
          forecasts were stored <b className="text-ink">before each day began</b> and are never changed
          afterwards, so they show how the model performs in real use. Watching this number over time is how
          you notice when a model needs retraining (model monitoring).
        </p>
      </Explainer>
    </Card>
  );
}

export default function Accuracy() {
  const c = useChartColors();
  const [days, setDays] = useState<number>(0);
  const q = useQuery({
    queryKey: ["benchmark", days],
    queryFn: () => api.benchmark(days || undefined),
    placeholderData: (prev) => prev,
  });

  const header = (
    <PageHeader
      eyebrow="Accuracy"
      title="How accurate is the model?"
      description="Every forecast is compared, 15 minutes at a time, with what really happened, alongside the official forecast and a naive rule of thumb. All numbers come from days the model did not learn from."
      actions={
        <Segmented
          ariaLabel="Evaluation window"
          value={days}
          onChange={setDays}
          options={[
            { value: 14, label: "14 days" },
            { value: 30, label: "30 days" },
            { value: 0, label: "All test days" },
          ]}
        />
      }
    />
  );

  if (q.isError)
    return (
      <>
        {header}
        <div className="card">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </div>
      </>
    );
  if (!q.data)
    return (
      <>
        {header}
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[200px] lg:col-span-2" />
          <Skeleton className="h-[340px] lg:col-span-2" />
          <Skeleton className="h-[320px]" />
          <Skeleton className="h-[320px]" />
        </div>
      </>
    );
  if (!q.data.available)
    return (
      <>
        {header}
        <div className="card">
          <EmptyState title="No evaluation available" description="The model has not been evaluated yet." />
        </div>
      </>
    );

  const b = q.data;
  const gain = ((b.summary.pse.mape - b.summary.model.mape) / b.summary.pse.mape) * 100;
  const avgMw = b.summary.model.mae;
  return (
    <>
      {header}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Headline"
          subtitle={`${dayLabel(b.start, false)} – ${dayLabel(b.end, false)} · ${b.n_days} days · every 15 minutes`}
          className="border-accent/40 bg-gradient-to-br from-accent/[0.08] to-transparent lg:col-span-1"
        >
          <div className="text-[13px] text-ink-2">On average my forecast misses by</div>
          <div className="tnum mt-1 text-[44px] font-semibold leading-none tracking-tight">
            {pct(b.summary.model.mape)}
          </div>
          <div className="mt-5 space-y-2 text-[14px]">
            <div className="flex justify-between gap-4">
              <span className="text-ink-2">vs official forecast</span>
              <span className={`tnum font-semibold ${gain >= 0 ? "text-good" : "text-bad"}`}>
                {gain >= 0 ? `${gain.toFixed(0)}% fewer errors` : `${(-gain).toFixed(0)}% more errors`}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-ink-2">vs naive guess</span>
              <span className="tnum font-semibold text-good">
                {(((b.summary.baseline.mape - b.summary.model.mape) / b.summary.baseline.mape) * 100).toFixed(
                  0,
                )}
                % fewer errors
              </span>
            </div>
          </div>
        </Card>
        <Card
          title="Error metrics"
          subtitle="Lower is better · best value in each column in bold"
          className="lg:col-span-2"
        >
          <SummaryTable b={b} />
          <div className="mt-4">
            <Callout icon={<Ruler size={16} />} tone="neutral">
              <b className="text-ink">How to read this:</b> an average miss of {pct(b.summary.model.mape)}{" "}
              means that when Poland uses 20 GW, the forecast is typically about{" "}
              {num((20000 * b.summary.model.mape) / 100)} MW off. Across this period the average miss was{" "}
              {num(avgMw)} MW, roughly the output of one large power-plant unit.
            </Callout>
          </div>
        </Card>

        <div className="lg:col-span-3">
          <LiveRecord />
        </div>

        <Card
          title="Daily error over time"
          subtitle="Average miss per day, in percent"
          action={<Legend />}
          className="lg:col-span-3"
        >
          <Chart
            ariaLabel="Daily MAPE over time for three forecasts"
            option={dailyOption(b, c)}
            height={320}
          />
          <Explainer>
            <p>
              Each point is one day. Spikes usually come from unusual days, such as public holidays, sudden
              weather changes or days with a lot of solar power, which are hard for every forecast. On days
              where the blue line is below the orange one, my model was closer to reality than the official
              forecast.
            </p>
          </Explainer>
        </Card>

        <Card title="Error by hour of day" subtitle="Average miss by local hour" className="lg:col-span-2">
          <Chart ariaLabel="MAPE by hour of day" option={hourOption(b, c)} height={300} />
          <div className="mt-3">
            <Legend />
          </div>
          <Explainer>
            <p>
              Midday hours are the hardest: rooftop solar panels cut the demand the grid sees, and how much
              they produce depends on clouds that are hard to forecast a day ahead.
            </p>
          </Explainer>
        </Card>
        <Card title="Weekdays vs weekends vs holidays" subtitle="Average miss by type of day">
          <Chart ariaLabel="MAPE by day type" option={dayTypeOption(b, c)} height={300} />
          <div className="mt-3">
            <Legend />
          </div>
          <Explainer>
            <p>
              The naive "same as last week" guess fails badly around holidays, because last week was a normal
              week. The model knows the Polish holiday calendar, so it handles them much better.
            </p>
          </Explainer>
        </Card>
      </div>
    </>
  );
}
