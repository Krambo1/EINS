"use client";

import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Viz } from "@/lib/stats-data";
import { formatEuro } from "@/lib/utils";

const ACCENT = "#58BAB5";
const MUTED = "#e4e4e7";
const TEXT = "#8a8a94";

export function StatViz({ viz }: { viz: Viz }) {
  switch (viz.kind) {
    case "radial":
      return <Radial value={viz.value} />;
    case "horizontalBar":
      return <HorizontalBar value={viz.value} comparison={viz.comparison} labels={viz.labels} />;
    case "comparativeBar":
      return <ComparativeBar a={viz.a} b={viz.b} unit={viz.unit} />;
    case "stars":
      return <Stars value={viz.value} />;
    case "gauge":
      return <Gauge value={viz.value} />;
    case "lineGrowth":
      return <LineGrowth points={viz.points} />;
    case "priceRange":
      return <PriceRange items={viz.items} />;
    case "bigNumber":
      return <BigNumber value={viz.value} caption={viz.caption} />;
  }
}

function Radial({ value }: { value: number }) {
  const radius = 90;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - value / 100);
  return (
    <div className="relative flex h-[260px] w-full items-center justify-center">
      <svg width="220" height="220" viewBox="0 0 220 220" className="-rotate-90">
        <circle cx="110" cy="110" r={radius} fill="none" stroke={MUTED} strokeWidth="12" />
        <motion.circle
          cx="110"
          cy="110"
          r={radius}
          fill="none"
          stroke={ACCENT}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="absolute font-mono text-3xl font-medium text-fg-primary">{value}%</div>
    </div>
  );
}

function HorizontalBar({
  value,
  comparison,
  labels,
}: {
  value: number;
  comparison: number;
  labels: [string, string];
}) {
  return (
    <div className="flex h-[260px] w-full flex-col justify-center gap-6 px-4">
      <div>
        <div className="mb-2 flex justify-between text-base font-mono text-fg-secondary">
          <span>{labels[0]}</span>
          <span className="text-accent">{value}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-bg-tertiary">
          <motion.div
            className="h-full rounded-full bg-accent"
            initial={{ width: 0 }}
            whileInView={{ width: `${value}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between text-base font-mono text-fg-secondary">
          <span>{labels[1]}</span>
          <span>{comparison}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-bg-tertiary">
          <motion.div
            className="h-full rounded-full bg-fg-tertiary"
            initial={{ width: 0 }}
            whileInView={{ width: `${comparison}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>
    </div>
  );
}

function ComparativeBar({
  a,
  b,
  unit,
}: {
  a: { label: string; value: number };
  b: { label: string; value: number };
  unit: string;
}) {
  const data = [a, b];
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 40 }}>
          <CartesianGrid horizontal={false} stroke={MUTED} />
          <XAxis type="number" stroke={TEXT} fontSize={12} tickFormatter={(v) => `${v}${unit.includes("%") ? "%" : ""}`} />
          <YAxis type="category" dataKey="label" stroke={TEXT} fontSize={12} width={110} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.03)" }}
            contentStyle={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 8, fontSize: 12 }}
            formatter={(v: number) => [`${v} ${unit}`, ""]}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={1000}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 1 ? ACCENT : "#d1d1d6"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stars({ value }: { value: number }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-4">
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <motion.svg
            key={i}
            width="44"
            height="44"
            viewBox="0 0 24 24"
            initial={{ scale: 0, rotate: -45 }}
            whileInView={{ scale: 1, rotate: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            fill={i <= value ? ACCENT : "none"}
            stroke={i <= value ? ACCENT : MUTED}
            strokeWidth="1.5"
          >
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </motion.svg>
        ))}
      </div>
      <div className="font-mono text-base text-fg-secondary">
        Mindestanforderung der Patienten
      </div>
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const radius = 90;
  const circ = Math.PI * radius;
  const offset = circ * (1 - value / 100);
  return (
    <div className="flex h-[260px] w-full flex-col items-center justify-center">
      <svg width="240" height="140" viewBox="0 0 220 120">
        <path d={`M 20 110 A ${radius} ${radius} 0 0 1 200 110`} fill="none" stroke={MUTED} strokeWidth="14" strokeLinecap="round" />
        <motion.path
          d={`M 20 110 A ${radius} ${radius} 0 0 1 200 110`}
          fill="none"
          stroke={ACCENT}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          whileInView={{ strokeDashoffset: offset }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <div className="-mt-4 font-mono text-3xl font-medium">{value}%</div>
    </div>
  );
}

function LineGrowth({ points }: { points: { year: string; value: number }[] }) {
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ left: 0, right: 20, top: 20, bottom: 0 }}>
          <CartesianGrid stroke={MUTED} vertical={false} />
          <XAxis dataKey="year" stroke={TEXT} fontSize={12} />
          <YAxis stroke={TEXT} fontSize={12} />
          <Tooltip
            contentStyle={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 8, fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={ACCENT}
            strokeWidth={3}
            dot={{ fill: ACCENT, r: 5 }}
            activeDot={{ r: 7 }}
            animationDuration={1400}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PriceRange({ items }: { items: { label: string; min: number; max: number }[] }) {
  const globalMax = Math.max(...items.map((i) => i.max));
  return (
    <div className="flex h-[260px] w-full flex-col justify-center gap-4 px-2">
      {items.map((item, idx) => {
        const leftPct = (item.min / globalMax) * 100;
        const widthPct = ((item.max - item.min) / globalMax) * 100;
        return (
          <div key={item.label}>
            <div className="mb-1 flex justify-between text-base font-mono text-fg-secondary">
              <span>{item.label}</span>
              <span className="text-fg-primary">
                {formatEuro(item.min)} &ndash; {formatEuro(item.max)}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-bg-tertiary">
              <motion.div
                className="absolute h-full rounded-full bg-accent"
                initial={{ width: 0, left: `${leftPct}%` }}
                whileInView={{ width: `${widthPct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1, delay: idx * 0.08, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BigNumber({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-3 text-center">
      <div className="font-display text-5xl font-semibold tracking-tighter text-accent-gradient md:text-6xl">
        {value}
      </div>
      <div className="max-w-sm text-base leading-relaxed text-fg-secondary">{caption}</div>
    </div>
  );
}
