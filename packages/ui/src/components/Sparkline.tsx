import * as React from "react";
import { cn } from "../lib/cn";

export type SparklineTone = "neutral" | "good" | "warn" | "bad" | "accent";

const stroke: Record<SparklineTone, string> = {
  neutral: "var(--fg-secondary)",
  good: "var(--tone-good)",
  warn: "var(--tone-warn)",
  bad: "var(--tone-bad)",
  accent: "var(--accent)",
};

export interface SparklineProps {
  values: number[];
  tone?: SparklineTone;
  height?: number;
  className?: string;
  /** Whether to render a gradient fill below the line. */
  filled?: boolean;
}

// Monotone cubic Hermite (Fritsch–Carlson) — smooth curve that never overshoots
// the input points. Matches recharts' `type="monotone"` for visual consistency
// with the full charts elsewhere in the app.
function monotoneCubicPath(
  pts: { x: number; y: number }[],
): { move: string; segments: string } {
  const n = pts.length;
  if (n === 0) return { move: "", segments: "" };
  const move = `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  if (n === 1) return { move, segments: "" };

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const m: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x;
    dy[i] = pts[i + 1].y - pts[i].y;
    m[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const t: number[] = new Array(n);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (m[i - 1] * m[i] <= 0) {
      t[i] = 0;
    } else {
      t[i] = (m[i - 1] + m[i]) / 2;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const k = 3 / h;
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }

  let segments = "";
  for (let i = 0; i < n - 1; i++) {
    const cp1x = pts[i].x + dx[i] / 3;
    const cp1y = pts[i].y + (t[i] * dx[i]) / 3;
    const cp2x = pts[i + 1].x - dx[i] / 3;
    const cp2y = pts[i + 1].y - (t[i + 1] * dx[i]) / 3;
    segments += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${pts[i + 1].x.toFixed(2)},${pts[i + 1].y.toFixed(2)}`;
  }
  return { move, segments };
}

/**
 * Lightweight inline-svg sparkline. No deps, no axes, no tooltips.
 * Matches the visual language of recharts AreaChart: thin monotone-cubic line
 * with a vertical gradient fill (top denser, bottom transparent).
 */
export function Sparkline({
  values,
  tone = "accent",
  height = 64,
  className,
  filled = true,
}: SparklineProps) {
  const reactId = React.useId();
  const gradId = `spark-grad-${reactId.replace(/:/g, "")}`;

  if (!values || values.length === 0) {
    return (
      <div
        className={cn("h-9 w-full rounded bg-bg-secondary/40", className)}
        style={{ height }}
        aria-hidden
      />
    );
  }

  const width = Math.max(values.length * 4, 80);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * height,
  }));

  const { move, segments } = monotoneCubicPath(points);
  const linePath = move + segments;
  const first = points[0];
  const last = points[points.length - 1];
  const areaPath = `M0,${height.toFixed(2)} L${first.x.toFixed(2)},${first.y.toFixed(2)}${segments} L${last.x.toFixed(2)},${height.toFixed(2)} Z`;

  return (
    <svg
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full overflow-visible", className)}
      style={{ height }}
      aria-hidden
    >
      {filled && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                style={{ stopColor: stroke[tone], stopOpacity: 0.35 }}
              />
              <stop
                offset="100%"
                style={{ stopColor: stroke[tone], stopOpacity: 0.04 }}
              />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        </>
      )}
      <path
        d={linePath}
        fill="none"
        stroke={stroke[tone]}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
