"use client";

import dynamic from "next/dynamic";
import { ChartSkeleton } from "./ChartSkeleton";
import type { LinePoint, LineSeries } from "./LineChartInner";

export type { LinePoint, LineSeries };

const LineChartImpl = dynamic(
  () => import("./LineChartInner").then((m) => m.LineChartInner),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function LineChart(props: {
  data: LinePoint[];
  series: LineSeries[];
  height?: number;
}) {
  return (
    <div style={{ height: props.height ?? 220 }}>
      <LineChartImpl {...props} />
    </div>
  );
}
