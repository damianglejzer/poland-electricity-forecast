import { useQuery } from "@tanstack/react-query";
import type { EChartsOption } from "echarts";
import {
  CalendarDays,
  Cloud,
  CloudSun,
  PartyPopper,
  RotateCcw,
  Snowflake,
  Sofa,
  Sun,
  Thermometer,
  ThermometerSun,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Chart } from "../components/Chart";
import {
  Card,
  EmptyState,
  ErrorState,
  Explainer,
  LegendDot,
  PageHeader,
  Segmented,
  Skeleton,
  Spinner,
  Term,
  TERMS,
} from "../components/ui";
import { api, ApiError, type Importance, type WhatIf as WhatIfData, type WhatIfRequest } from "../lib/api";
import { axisCommon, baseOption, tooltipRow } from "../lib/chart";
import { WEEKDAY_NAMES, addDays, dayLabel, featureLabel, gw, hhmm, mw, num } from "../lib/format";
import { type ChartColors, useChartColors } from "../lib/theme";

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

function curveOption(d: WhatIfData, c: ChartColors): EChartsOption {
  const labels = d.points.map((p) => p.ts);
  return {
    ...baseOption(c),
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      formatter: (params: unknown) => {
        const ps = params as { dataIndex: number }[];
        const p = d.points[ps[0].dataIndex];
        const delta = p.scenario - p.base;
        return `<div style="font-weight:600;margin-bottom:4px">${hhmm(p.ts)}</div>
          ${tooltipRow(c.muted, "Normal", mw(p.base), true)}
          ${tooltipRow(c.model, "Your scenario", mw(p.scenario))}
          ${tooltipRow("transparent", "Difference", `${delta >= 0 ? "+" : ""}${mw(delta)}`)}`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      ...axisCommon(c),
      splitLine: { show: false },
      axisLabel: {
        color: c.muted,
        fontSize: 11,
        interval: (_i: number, v: string) => hhmm(v).endsWith(":00") && Number(hhmm(v).slice(0, 2)) % 3 === 0,
        formatter: (v: string) => hhmm(v),
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)} GW` },
    },
    series: [
      {
        name: "Normal",
        type: "line",
        data: d.points.map((p) => p.base),
        showSymbol: false,
        lineStyle: { width: 2, color: c.muted, type: "dashed" },
        itemStyle: { color: c.muted },
      },
      {
        name: "Scenario",
        type: "line",
        data: d.points.map((p) => p.scenario),
        showSymbol: false,
        symbolSize: 8,
        lineStyle: { width: 2.5, color: c.model },
        itemStyle: { color: c.model },
        areaStyle: { color: c.modelSoft, origin: "start" },
      },
    ],
  };
}

function contribOption(d: WhatIfData, c: ChartColors, mode: "scenario" | "delta"): EChartsOption {
  const rows = [...d.contributions]
    .sort((a, b) => Math.abs(b[mode]) - Math.abs(a[mode]))
    .slice(0, 10)
    .reverse();
  const up = c.bad;
  const down = c.model;
  return {
    ...baseOption(c),
    grid: { left: 16, right: 64, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      axisPointer: { type: "shadow", shadowStyle: { color: c.accentSoft } },
      formatter: (params: unknown) => {
        const r = rows[(params as { dataIndex: number }[])[0].dataIndex];
        return `<div style="font-weight:600;margin-bottom:4px">${featureLabel(r.feature)}</div>
          ${tooltipRow(c.muted, "Unchanged", `${r.base > 0 ? "+" : ""}${num(r.base)} MW`)}
          ${tooltipRow(c.model, "Scenario", `${r.scenario > 0 ? "+" : ""}${num(r.scenario)} MW`)}
          <div style="color:${c.muted};font-size:11px;margin-top:4px">Average effect on demand over the day (SHAP)</div>`;
      },
    },
    xAxis: {
      type: "value",
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => `${v > 0 ? "+" : ""}${num(v)}` },
    },
    yAxis: {
      type: "category",
      data: rows.map((r) => featureLabel(r.feature)),
      ...axisCommon(c),
      axisLine: { show: false },
      axisLabel: { color: c.ink2, fontSize: 12 },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        data: rows.map((r) => ({
          value: r[mode],
          itemStyle: {
            color: r[mode] >= 0 ? up : down,
            borderRadius: r[mode] >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
        })),
        label: {
          show: true,
          position: "right",
          color: c.ink2,
          fontSize: 11,
          formatter: (p: { value: unknown }) => {
            const v = p.value as number;
            return `${v > 0 ? "+" : ""}${num(v)} MW`;
          },
        },
      },
    ],
  };
}

const GROUP_LABEL: Record<string, string> = {
  "recent demand": "Recent demand",
  calendar: "Calendar",
  weather: "Weather",
};

function GlobalImportance({ imp }: { imp: Importance }) {
  const total = Object.values(imp.groups).reduce((a, b) => a + b, 0);
  const groups = Object.entries(imp.groups).sort((a, b) => b[1] - a[1]);
  const top = imp.features.slice(0, 8);
  const maxShap = top[0]?.mean_abs_shap ?? 1;
  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow mb-3">Share by type of input</div>
        <div className="space-y-3">
          {groups.map(([g, v]) => (
            <div key={g}>
              <div className="mb-1 flex justify-between text-[13px]">
                <span>{GROUP_LABEL[g] ?? g}</span>
                <span className="tnum text-ink-2">{((v / total) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${(v / total) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-3">Top inputs · average effect</div>
        <ul className="space-y-2">
          {top.map((f) => (
            <li key={f.feature} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-[13px]">
              <span className="truncate">{featureLabel(f.feature)}</span>
              <span className="tnum text-ink-2">{num(f.mean_abs_shap)} MW</span>
              <div className="col-span-2 mt-1 h-1 rounded-full bg-surface-2">
                <div
                  className="h-1 rounded-full bg-ink-2/60"
                  style={{ width: `${(f.mean_abs_shap / maxShap) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({
  label,
  base,
  scenario,
  unit,
}: {
  label: string;
  base: number;
  scenario: number;
  unit: "GW" | "GWh";
}) {
  const delta = scenario - base;
  const fmt = (v: number) => (unit === "GW" ? gw(v) : `${num(v, 1)} GWh`);
  const pctDelta = (delta / base) * 100;
  return (
    <div className="rounded-xl bg-surface-2/70 p-4">
      <div className="eyebrow">{label}</div>
      <div className="tnum mt-2 text-xl font-semibold">{fmt(scenario)}</div>
      <div className="tnum mt-1 text-[13px] text-ink-2">
        was {fmt(base)} ·{" "}
        <span className={Math.abs(pctDelta) < 0.05 ? "" : delta > 0 ? "text-bad" : "text-good"}>
          {delta >= 0 ? "+" : ""}
          {pctDelta.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

const DEFAULTS: WhatIfRequest = { temp_delta: 0, cloud_cover: null, holiday: null, dow: null };

const PRESETS: { label: string; hint: string; icon: typeof Sun; params: Partial<WhatIfRequest> }[] = [
  { label: "Cold snap", hint: "10 °C colder", icon: Snowflake, params: { temp_delta: -10 } },
  { label: "Heatwave", hint: "8 °C warmer", icon: ThermometerSun, params: { temp_delta: 8 } },
  { label: "Public holiday", hint: "offices closed", icon: PartyPopper, params: { holiday: true } },
  { label: "Lazy Sunday", hint: "treat as Sunday", icon: Sofa, params: { dow: 6 } },
  { label: "Clear sky", hint: "full sunshine", icon: Sun, params: { cloud_cover: 0 } },
  { label: "Overcast", hint: "thick clouds", icon: Cloud, params: { cloud_cover: 100 } },
];

export default function WhatIf() {
  const c = useChartColors();
  const [date, setDate] = useState<string | undefined>(undefined);
  const [params, setParams] = useState<WhatIfRequest>(DEFAULTS);
  const [mode, setMode] = useState<"scenario" | "delta">("scenario");
  const request = useDebounced({ ...params, date });
  const q = useQuery({
    queryKey: ["whatif", request],
    queryFn: () => api.whatif(request),
    placeholderData: (prev) => prev,
    retry: false,
  });
  const imp = useQuery({ queryKey: ["importance"], queryFn: api.importance, retry: false });
  const kpis = useQuery({ queryKey: ["kpis"], queryFn: api.kpis });
  const set = (patch: Partial<WhatIfRequest>) => setParams((p) => ({ ...p, ...patch }));
  const changed = JSON.stringify(params) !== JSON.stringify(DEFAULTS);

  const header = (
    <PageHeader
      eyebrow="What-if simulator"
      title="What would change the forecast?"
      description="Pick a scenario or move the sliders: the model is run live on your changes and shows how demand would react, and why."
    />
  );
  const presetKey = (patch: Partial<WhatIfRequest>) => JSON.stringify({ ...DEFAULTS, ...patch });

  if (q.isError && (q.error as ApiError).status === 404)
    return (
      <>
        {header}
        <div className="card">
          <EmptyState title="No model deployed" description="The simulator needs a deployed model." />
        </div>
      </>
    );

  const d = q.data;
  const inputs = d?.inputs;
  const minDate = kpis.data?.first_day ? addDays(kpis.data.first_day, 15) : undefined;

  return (
    <>
      {header}
      <section aria-label="Scenario presets" className="mb-6">
        <div className="eyebrow mb-3">Try a scenario</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {PRESETS.map(({ label, hint, icon: Icon, params: patch }) => {
            const active = JSON.stringify(params) === presetKey(patch);
            return (
              <button
                key={label}
                onClick={() => setParams(active ? DEFAULTS : { ...DEFAULTS, ...patch })}
                aria-pressed={active}
                className={`card flex items-center gap-3 p-3 text-left transition hover:border-accent/50 ${
                  active ? "!border-accent bg-accent/10" : ""
                }`}
              >
                <span
                  className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${
                    active ? "bg-accent text-white" : "bg-surface-2 text-ink-2"
                  }`}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{label}</span>
                  <span className="block truncate text-[12px] text-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <Card
          title="Fine-tune"
          subtitle={d ? `${dayLabel(d.date)} · ${d.date.slice(0, 4)}` : "Loading…"}
          action={
            <button
              className="btn-ghost !px-2.5 !py-1.5 text-[13px]"
              onClick={() => setParams(DEFAULTS)}
              disabled={!changed}
            >
              <RotateCcw size={14} /> Reset
            </button>
          }
          className="xl:sticky xl:top-6 xl:self-start"
        >
          <div className="space-y-6">
            <label className="block">
              <span className="eyebrow flex items-center gap-1.5">
                <CalendarDays size={13} /> Target day
              </span>
              <input
                type="date"
                className="tnum mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:ring-2 focus:ring-accent/50"
                value={date ?? d?.date ?? ""}
                min={minDate}
                max={kpis.data?.last_day ?? undefined}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>

            <div>
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5">
                  <Thermometer size={13} /> Temperature change
                </span>
                <span className="tnum text-[14px] font-semibold">
                  {params.temp_delta > 0 ? "+" : ""}
                  {params.temp_delta} °C
                </span>
              </div>
              <input
                type="range"
                className="slider mt-3"
                min={-10}
                max={10}
                step={0.5}
                value={params.temp_delta}
                aria-label="Temperature change in degrees Celsius"
                onChange={(e) => set({ temp_delta: Number(e.target.value) })}
              />
              <div className="mt-1 flex justify-between text-[12px] text-muted">
                <span>−10 °C</span>
                <span>
                  forecast mean {inputs ? `${num(inputs.temperature_mean + params.temp_delta, 1)} °C` : "–"}
                </span>
                <span>+10 °C</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <span className="eyebrow flex items-center gap-1.5">
                  <CloudSun size={13} /> Cloud cover
                </span>
                <label className="flex items-center gap-2 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    className="accent-[rgb(var(--accent))]"
                    checked={params.cloud_cover !== null}
                    onChange={(e) =>
                      set({
                        cloud_cover: e.target.checked ? Math.round(inputs?.cloud_cover_mean ?? 50) : null,
                      })
                    }
                  />
                  Override
                </label>
              </div>
              <input
                type="range"
                className="slider mt-3"
                min={0}
                max={100}
                step={5}
                disabled={params.cloud_cover === null}
                value={params.cloud_cover ?? Math.round(inputs?.cloud_cover_mean ?? 50)}
                aria-label="Cloud cover percent"
                onChange={(e) => set({ cloud_cover: Number(e.target.value) })}
              />
              <div className="mt-1 flex justify-between text-[12px] text-muted">
                <span>Clear sky</span>
                <span className="tnum">
                  {params.cloud_cover !== null
                    ? `${params.cloud_cover}%`
                    : `forecast ${num(inputs?.cloud_cover_mean)}%`}
                </span>
                <span>Overcast</span>
              </div>
            </div>

            <div>
              <span className="eyebrow">Public holiday</span>
              <div className="mt-2">
                <Segmented
                  ariaLabel="Public holiday"
                  value={params.holiday === null ? "auto" : params.holiday ? "yes" : "no"}
                  onChange={(v) => set({ holiday: v === "auto" ? null : v === "yes" })}
                  options={[
                    {
                      value: "auto",
                      label: inputs ? (inputs.is_holiday ? "Calendar (yes)" : "Calendar (no)") : "Calendar",
                    },
                    { value: "yes", label: "Holiday" },
                    { value: "no", label: "Working day" },
                  ]}
                />
              </div>
              {inputs?.holiday_name && <p className="mt-1.5 text-[12px] text-muted">{inputs.holiday_name}</p>}
            </div>

            <div>
              <span className="eyebrow">Treat as day of week</span>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {[null, 0, 1, 2, 3, 4, 5, 6].map((v) => {
                  const active = params.dow === v;
                  const label =
                    v === null
                      ? `As is${inputs ? ` (${WEEKDAY_NAMES[inputs.dow].slice(0, 3)})` : ""}`
                      : WEEKDAY_NAMES[v].slice(0, 3);
                  return (
                    <button
                      key={String(v)}
                      onClick={() => set({ dow: v })}
                      aria-pressed={active}
                      className={`rounded-lg border px-2 py-1.5 text-[12px] font-medium transition ${
                        v === null ? "col-span-4" : ""
                      } ${active ? "border-accent bg-accent/12 text-accent" : "border-line text-ink-2 hover:bg-surface-2"}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[12px] text-muted">
                Changes calendar features only; recent-demand inputs stay as observed.
              </p>
            </div>
          </div>
        </Card>

        <div className="min-w-0 space-y-6">
          <Card
            title="Forecast for the day"
            subtitle={
              d ? `Dashed: the normal forecast · blue: your scenario · model ${d.model_version}` : undefined
            }
            action={
              <div className="flex items-center gap-4">
                {q.isFetching && <Spinner />}
                <LegendDot color={c.muted} dashed label="Normal" />
                <LegendDot color={c.model} label="Your scenario" />
              </div>
            }
          >
            {q.isError ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !d ? (
              <Skeleton className="h-[340px]" />
            ) : (
              <>
                <Chart
                  ariaLabel="Unchanged vs scenario forecast curve"
                  option={curveOption(d, c)}
                  height={340}
                />
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Stat
                    label={`Peak · ${hhmm(d.summary.scenario_peak_ts)}`}
                    base={d.summary.base_peak}
                    scenario={d.summary.scenario_peak}
                    unit="GW"
                  />
                  <Stat
                    label="Daily energy"
                    base={d.summary.base_energy_gwh}
                    scenario={d.summary.scenario_energy_gwh}
                    unit="GWh"
                  />
                  <div className="rounded-xl bg-surface-2/70 p-4">
                    <div className="eyebrow">Average change</div>
                    <div className="tnum mt-2 text-xl font-semibold">
                      {(() => {
                        const v = ((d.summary.scenario_energy_gwh - d.summary.base_energy_gwh) * 1000) / 24;
                        return `${v >= 0 ? "+" : ""}${num(v)} MW`;
                      })()}
                    </div>
                    <div className="mt-1 text-[13px] text-ink-2">mean load difference</div>
                  </div>
                </div>
              </>
            )}
          </Card>

          <div className="grid gap-6 2xl:grid-cols-[1fr_340px]">
            <Card
              title="Why the model predicts this"
              subtitle={
                mode === "scenario"
                  ? "How much each input pushes demand up or down, on average over the day"
                  : "How each input's push changed in your scenario"
              }
              action={
                <Segmented
                  ariaLabel="Contribution view"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: "scenario", label: "All drivers" },
                    { value: "delta", label: "What changed" },
                  ]}
                />
              }
            >
              {!d ? (
                <Skeleton className="h-[340px]" />
              ) : (
                <>
                  <Chart
                    ariaLabel="Horizontal bar chart of SHAP feature contributions"
                    option={contribOption(d, c, mode)}
                    height={340}
                  />
                  <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
                    <LegendDot color={c.bad} label="Raises demand" />
                    <LegendDot color={c.model} label="Lowers demand" />
                    <span>Starting point (average prediction): {gw(d.summary.expected_value)}</span>
                  </div>
                  <Explainer>
                    <p>
                      The model starts from its average prediction and every input adds or removes some
                      megawatts. Red bars push demand up, blue bars push it down. These are{" "}
                      <Term tip={TERMS.shap}>SHAP values</Term>, a standard way to explain individual
                      predictions of machine-learning models.
                    </p>
                    <p>
                      For example, on a cold winter evening "Temperature" and "Time of day" push demand up,
                      while a Sunday pushes it down because offices and factories are closed.
                    </p>
                  </Explainer>
                </>
              )}
            </Card>
            <Card title="What the model relies on" subtitle="Average importance across the test period">
              {imp.data ? (
                <GlobalImportance imp={imp.data} />
              ) : imp.isError ? (
                <EmptyState title="Not available" description="No model deployed." />
              ) : (
                <Skeleton className="h-[300px]" />
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
