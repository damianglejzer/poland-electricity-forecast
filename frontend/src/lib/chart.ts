import type { EChartsOption } from "echarts";

import type { ChartColors } from "./theme";

/** Shared, recessive chart chrome: thin grid, muted axes, crosshair tooltip. */
export function baseOption(c: ChartColors): EChartsOption {
  return {
    animationDuration: 400,
    textStyle: { fontFamily: '"Inter Variable", Inter, system-ui, sans-serif', color: c.ink2 },
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis",
      backgroundColor: c.surface,
      borderColor: c.line,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: c.ink, fontSize: 12 },
      extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgb(0 0 0 / .18);",
      axisPointer: { type: "line", lineStyle: { color: c.muted, width: 1, type: "dashed" } },
    },
  };
}

export const axisCommon = (c: ChartColors) => ({
  axisLine: { lineStyle: { color: c.line } },
  axisTick: { show: false },
  axisLabel: { color: c.muted, fontSize: 11 },
  splitLine: { lineStyle: { color: c.grid } },
});

export function tooltipRow(color: string, label: string, value: string, dashed = false) {
  const swatch = dashed
    ? `<span style="display:inline-block;width:12px;border-top:2px dashed ${color};margin-right:8px;vertical-align:middle"></span>`
    : `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${color};margin-right:8px;vertical-align:middle"></span>`;
  return `<div style="display:flex;justify-content:space-between;gap:24px;line-height:1.7">
    <span>${swatch}${label}</span><b style="font-variant-numeric:tabular-nums">${value}</b></div>`;
}
