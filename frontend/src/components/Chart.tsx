import { BarChart, LineChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import ReactEChartsCore from "echarts-for-react/lib/core";

import { useTheme } from "../lib/theme";

// Register only what the site uses, which keeps the chart bundle small.
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  SVGRenderer,
]);

export function Chart({
  option,
  height = 320,
  ariaLabel,
}: {
  option: EChartsOption;
  height?: number;
  ariaLabel: string;
}) {
  const { theme } = useTheme();
  return (
    <div role="img" aria-label={ariaLabel}>
      <ReactEChartsCore
        echarts={echarts}
        key={theme}
        option={option}
        notMerge
        lazyUpdate
        style={{ height, width: "100%" }}
        opts={{ renderer: "svg" }}
      />
    </div>
  );
}
