"use client";
import * as React from "react";
import { bin, extent } from "d3-array";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type ChartType = "histogram" | "bar" | "pie";
type NumericKey = "accelerationGNum" | "occurredAtMs";
type CategoricalKey = "team" | "playerName";
type Agg = "count" | "sum" | "avg";

type Row = {
  id: string;
  playerName: string;
  team?: string | null;
  occurredAt: string;
  accelerationG: number | string;
  accelerationGNum: number;
  occurredAtMs: number;
};

export function EventsChart(props: {
  rows: Row[];
  chartType: ChartType;
  xVar?: NumericKey;
  yVar?: NumericKey;
  groupBy?: CategoricalKey;
  agg?: Agg;
}) {
  const { rows, chartType, xVar, yVar, groupBy, agg = "count" } = props;

  if (!rows?.length) {
    return <div className="text-sm text-gray-600">No data to chart.</div>;
  }

  function buildHistogram(xKey: NumericKey, binsCount: number) {
    const values = rows.map(r => r[xKey]).filter(v => Number.isFinite(v)) as number[];
    if (!values.length) return [];
    const [min, max] = extent(values) as [number, number];
    if (!(Number.isFinite(min) && Number.isFinite(max)) || min === max) {
      return [{ x0: min ?? 0, x1: (max ?? 0) + 1, count: values.length }];
    }
    const bins = bin().domain([min, max]).thresholds(binsCount)(values);
    return bins.map(b => ({ x0: b.x0!, x1: b.x1!, count: b.length }));
  }

  function buildPie(groupKey: CategoricalKey, aggregation: Agg) {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const key = String(r[groupKey] ?? "Unknown");
      const v = Number.isFinite(r.accelerationGNum) ? r.accelerationGNum : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    const data = Array.from(groups.entries()).map(([name, arr]) => {
      if (aggregation === "count") return { name, value: arr.length };
      if (aggregation === "sum") return { name, value: arr.reduce((a, b) => a + b, 0) };
      const sum = arr.reduce((a, b) => a + b, 0);
      return { name, value: arr.length ? sum / arr.length : 0 };
    });
    data.sort((a, b) => b.value - a.value);
    return data;
  }

  const COLORS = [
    "#8b5cf6", // violet-500
    "#a78bfa", // violet-400
    "#7c3aed", // violet-600
    "#c4b5fd", // violet-300
    "#6d28d9", // violet-700
    "#d8b4fe", // purple-300
    "#9333ea", // purple-600
    "#a855f7", // purple-500
    "#e9d5ff", // purple-200
    "#581c87"  // purple-900
  ];

  if (chartType === "histogram" && xVar) {
    // For accelerationG, use fixed bins: 0-30, 31-60, 61+
    if (xVar === "accelerationGNum") {
      const buckets = [
        { bucket: "0–30", count: 0 },
        { bucket: "31–60", count: 0 },
        { bucket: "61+", count: 0 },
      ];
      const severityByBucket: Record<string, string> = {
        "0–30": "Mild",
        "31–60": "Moderate",
        "61+": "Dangerous",
      };
      for (const r of rows) {
        const v = r.accelerationGNum;
        if (!Number.isFinite(v)) continue;
        if (v <= 30) buckets[0].count += 1;
        else if (v <= 60) buckets[1].count += 1;
        else buckets[2].count += 1;
      }
      type TickProps = { x?: number; y?: number; payload?: { value?: string } };
      function SeverityTick({ x = 0, y = 0, payload = {} }: TickProps) {
        const label = payload.value ?? "";
        const severity = severityByBucket[label] ?? "";
        return (
          <g transform={`translate(${x},${y})`}>
            <text dy={16} textAnchor="middle" fill="#111827">{label}</text>
            <text dy={32} textAnchor="middle" fill="#1f2937" fontSize={12}>{severity}</text>
          </g>
        );
      }
      return (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" stroke="#c4b5fd" />
            <XAxis dataKey="bucket" tick={<SeverityTick />} height={48} />
            <YAxis allowDecimals={false} />
            <Tooltip cursor={{ fill: "#ddd6fe", opacity: 0.6 }} />
            <Bar dataKey="count" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // For time, bucket by calendar month between min and max
    if (xVar === "occurredAtMs") {
      const values = rows.map(r => r.occurredAtMs).filter(v => Number.isFinite(v)) as number[];
      if (!values.length) {
        return <div className="text-sm text-gray-600">No data to chart.</div>;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const start = new Date(min);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(max);
      end.setDate(1);
      end.setHours(0, 0, 0, 0);

      const counts = new Map<string, number>();
      for (const ms of values) {
        const d = new Date(ms);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      const data: { bucket: string; count: number }[] = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
        data.push({ bucket: key, count: counts.get(key) ?? 0 });
        cursor.setMonth(cursor.getMonth() + 1);
      }

      return (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#c4b5fd" />
            <XAxis dataKey="bucket" />
            <YAxis allowDecimals={false} />
          <Tooltip cursor={{ fill: "#ddd6fe", opacity: 0.6 }} />
            <Bar dataKey="count" fill="#8b5cf6" />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Default numeric binning for time-based histograms
    const defaultBins = 20;
    const data = buildHistogram(xVar, defaultBins);
    const formatted = data.map(d => ({
      bucket: `${Number.isFinite(d.x0) ? (d.x0 as number).toFixed(1) : d.x0}–${Number.isFinite(d.x1) ? (d.x1 as number).toFixed(1) : d.x1}`,
      count: d.count,
    }));
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" stroke="#c4b5fd" />
          <XAxis dataKey="bucket" />
          <YAxis allowDecimals={false} />
        <Tooltip cursor={{ fill: "#ddd6fe", opacity: 0.6 }} />
          <Bar dataKey="count" fill="#8b5cf6" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "bar" && groupBy) {
    const groups = new Map<string, number[]>();
    for (const r of rows) {
      const key = String(r[groupBy] ?? "Unknown");
      const v = Number.isFinite(r.accelerationGNum) ? r.accelerationGNum : 0;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    const data = Array.from(groups.entries()).map(([name, arr]) => {
      if (agg === "avg") {
        const sum = arr.reduce((a, b) => a + b, 0);
        return { name, value: arr.length ? sum / arr.length : 0 };
      }
      // default to count
      return { name, value: arr.length };
    });
    data.sort((a, b) => b.value - a.value);
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#c4b5fd" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" name={agg === "avg" ? "Avg acceleration (g)" : "Count"} fill="#8b5cf6" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "pie" && groupBy) {
    const data = buildPie(groupBy, agg);
    return (
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" outerRadius={110} label>
            {data.map((_, idx) => {
              // Make the secondary color a yellow accent for contrast
              const fallback = COLORS[idx % COLORS.length];
              const color = idx % 2 === 1 ? "#facc15" /* yellow-400 */ : fallback;
              return <Cell key={idx} fill={color} />;
            })}
          </Pie>
          <Tooltip />
          <Legend formatter={(value: string) => (<span style={{ color: '#000000' }}>{value}</span>)} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return <div className="text-sm text-gray-600">Unsupported chart configuration.</div>;
}

export default EventsChart;


