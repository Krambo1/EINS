"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "./ChartSkeleton";
import type { AreaChartPoint, AreaChartSeries } from "./AreaChartInner";

export type { AreaChartPoint, AreaChartSeries };

interface Props {
  data: AreaChartPoint[];
  series: AreaChartSeries[];
  height?: number;
  yKind?: "eur" | "number";
  showGrid?: boolean;
}

// recharts ships in its own client chunk; only loaded when a chart actually renders.
const AreaChartImpl = dynamic(
  () => import("./AreaChartInner").then((m) => m.AreaChartInner),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function AreaChart(props: Props) {
  return (
    <div style={{ height: props.height ?? 240 }}>
      <AreaChartImpl {...props} />
    </div>
  );
}
