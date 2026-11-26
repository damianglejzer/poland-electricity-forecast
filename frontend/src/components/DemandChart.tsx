import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useState } from "react";

import type { Series } from "../lib/api";
import { axisCommon, baseOption, tooltipRow } from "../lib/chart";
import { dayLabel, hhmm, mw, ymd } from "../lib/format";
import { type ChartColors, useChartColors } from "../lib/theme";
import { Chart } from "./Chart";
import { LegendDot } from "./ui";

export function useNarrow(breakpoint = 640) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < breakpoint);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpoint]);
  return narrow;
}

export const SERIES_LABELS = {
  actual: "Actual demand",
  model: "GridCast model",
  pse: "Official forecast (PSE)",
  baseline: "Naive guess (last week)",
} as const;

function demandOption(
  s: Series,
  c: ChartColors,
  nowIdx: number | null,
  narrow: boolean,
  showBaseline: boolean,
): EChartsOption {
  const labels = s.points.map((p) => p.ts);
  const forecastStart = s.days.findIndex(
    (d) => d.model_kind === "forecast" && s.points.some((p) => p.actual == null && ymd(p.ts) === d.date),
  );
  const dayStart =
    forecastStart >= 0 ? s.points.findIndex((p) => ymd(p.ts) === s.days[forecastStart].date) : -1;
  const colors: Record<string, [string, boolean]> = {
    [SERIES_LABELS.actual]: [c.ink, false],
    [SERIES_LABELS.model]: [c.model, false],
    [SERIES_LABELS.pse]: [c.pse, false],
    [SERIES_LABELS.baseline]: [c.base, true],
  };
  const line = (key: keyof typeof SERIES_LABELS, color: string, extra = {}) => ({
    name: SERIES_LABELS[key],
    type: "line" as const,
    data: s.points.map((p) => p[key]),
    showSymbol: false,
    symbolSize: 8,
    connectNulls: false,
    lineStyle: { width: 2, color },
    itemStyle: { color },
    emphasis: { focus: "series" as const },
    ...extra,
  });
  const series = [
    line("actual", c.ink, {
      z: 5,
      lineStyle: { width: 2.5, color: c.ink },
      markLine:
        nowIdx != null
          ? {
              silent: true,
              symbol: "none",
              label: { formatter: "now", color: c.muted, fontSize: 11 },
              lineStyle: { color: c.muted, type: "dashed", width: 1 },
              data: [{ xAxis: nowIdx }],
            }
          : undefined,
      markArea:
        dayStart > 0
          ? {
              silent: true,
              itemStyle: { color: c.accentSoft },
              label: { color: c.muted, fontSize: 11, position: "insideTop" },
              data: [[{ xAxis: dayStart, name: "forecast for tomorrow" }, { xAxis: labels.length - 1 }]],
            }
          : undefined,
    }),
    line("model", c.model, { z: 4 }),
    line("pse", c.pse, { z: 3 }),
  ];
  if (showBaseline)
    series.push(line("baseline", c.base, { z: 2, lineStyle: { width: 1.5, color: c.base, type: "dashed" } }));
  return {
    ...baseOption(c),
    grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
    tooltip: {
      ...(baseOption(c).tooltip as object),
      formatter: (params: unknown) => {
        const ps = params as { seriesName: string; value: number | null; dataIndex: number }[];
        if (!ps.length) return "";
        const ts = labels[ps[0].dataIndex];
        const rows = ps
          .filter((p) => p.value != null)
          .map((p) => tooltipRow(colors[p.seriesName][0], p.seriesName, mw(p.value), colors[p.seriesName][1]))
          .join("");
        return `<div style="font-weight:600;margin-bottom:4px">${dayLabel(ymd(ts))}, ${hhmm(ts)}</div>${rows}`;
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
        interval: (_i: number, v: string) =>
          (narrow ? ["00:00", "12:00"] : ["00:00", "06:00", "12:00", "18:00"]).includes(hhmm(v)),
        formatter: (v: string) => (hhmm(v) === "00:00" ? dayLabel(ymd(v)) : hhmm(v)),
        hideOverlap: true,
      },
    },
    yAxis: {
      type: "value",
      scale: true,
      ...axisCommon(c),
      axisLabel: { color: c.muted, fontSize: 11, formatter: (v: number) => `${(v / 1000).toFixed(0)} GW` },
    },
    series,
  };
}

export function DemandLegend({ showBaseline = false }: { showBaseline?: boolean }) {
  const c = useChartColors();
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <LegendDot color={c.ink} label={SERIES_LABELS.actual} />
      <LegendDot color={c.model} label={SERIES_LABELS.model} />
      <LegendDot color={c.pse} label={SERIES_LABELS.pse} />
      {showBaseline && <LegendDot color={c.base} dashed label={SERIES_LABELS.baseline} />}
    </div>
  );
}

export function DemandChart({
  series,
  actualsUntil,
  height = 400,
  showBaseline = false,
}: {
  series: Series;
  actualsUntil?: string | null;
  height?: number;
  showBaseline?: boolean;
}) {
  const c = useChartColors();
  const narrow = useNarrow();
  const nowIdx = useMemo(() => {
    if (!actualsUntil) return null;
    const i = series.points.findIndex((p) => p.ts >= actualsUntil);
    return i > 0 && series.points[i].actual == null ? i : null;
  }, [series, actualsUntil]);
  return (
    <Chart
      ariaLabel="Line chart of actual electricity demand, the GridCast forecast and the official forecast"
      option={demandOption(series, c, nowIdx, narrow, showBaseline)}
      height={height}
    />
  );
}
