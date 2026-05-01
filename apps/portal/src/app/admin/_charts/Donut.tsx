"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ChartSkeleton } from "./ChartSkeleton";
import type { DonutSlice } from "./DonutInner";

export type { DonutSlice };

interface Props {
  slices: DonutSlice[];
  centerLabel?: React.ReactNode;
  centerSubLabel?: React.ReactNode;
  height?: number;
  valueKind?: "eur" | "number";
}

const DonutImpl = dynamic(
  () => import("./DonutInner").then((m) => m.DonutInner),
  {
    ssr: false,
    loading: () => <ChartSkeleton />,
  }
);

export function Donut(props: Props) {
  return (
    <div style={{ height: props.height ?? 220 }}>
      <DonutImpl {...props} />
    </div>
  );
}
