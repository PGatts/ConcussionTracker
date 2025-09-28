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
type NumericKey = "accelerationGNum" | "angularVelocityNum" | "occurredAtMs";
type CategoricalKey = "team" | "playerName" | "timeYear";
type Agg = "count" | "sum" | "avg" | "sumOmega" | "avgAngular";

type Row = {
  id: string;
  playerName: string;
  team?: string | null;
  occurredAt: string;
  accelerationG: number | string;
  accelerationGNum: number;
  occurredAtMs: number;
  angularVelocityNum?: number;
};

function getGroupKey(r: Row, key: CategoricalKey): string {
  if (key === "timeYear") {
    const d = new Date(r.occurredAt);
    return String(d.getFullYear());
  }
  if (key === "team") return String(r.team ?? "Unknown");
  return String(r.playerName);
}

export function EventsChart(props: {
  rows: Row[];
  chartType: ChartType;
  xVar?: NumericKey;
  yVar?: NumericKey;
  groupBy?: CategoricalKey;
  agg?: Agg;
}) {
  const { rows, chartType, xVar, groupBy, agg = "count" } = props;

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
      const key = getGroupKey(r, groupKey);
      const v = aggregation === "sumOmega"
        ? (Number.isFinite(r.angularVelocityNum ?? NaN) ? (r.angularVelocityNum as number) : 0)
        : (Number.isFinite(r.accelerationGNum) ? r.accelerationGNum : 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(v);
    }
    const data = Array.from(groups.entries()).map(([name, arr]) => {
      if (aggregation === "count") return { name, value: arr.length };
      if (aggregation === "sum" || aggregation === "sumOmega") return { name, value: arr.reduce((a, b) => a + b, 0) };
      const sum = arr.reduce((a, b) => a + b, 0);
      return { name, value: arr.length ? sum / arr.length : 0 };
    }).map(d => ({ name: d.name, value: typeof d.value === 'number' ? Number((d.value as number).toFixed(1)) : d.value }));
    data.sort((a, b) => b.value - a.value);
    return data;
  }

  // For the pie chart specifically: start with purple and yellow, then cycle other distinct colors
  const PIE_COLORS = [
    "#8b5cf6", // purple (violet-500)
    "#facc15", // yellow (yellow-400)
    "#10b981", // emerald-500
    "#38bdf8", // sky-400
    "#f43f5e", // rose-500
    "#fb923c", // orange-400
    "#6366f1", // indigo-500
    "#06b6d4", // cyan-500
    "#14b8a6", // teal-500
    "#ec4899", // pink-500
    "#84cc16", // lime-500
    "#3b82f6"  // blue-500
  ];

  if (chartType === "histogram" && xVar) {
    // For accelerationG, use fixed bins: 0-30, 31-60, 61+
    if (xVar === "accelerationGNum" || xVar === "angularVelocityNum") {
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
        const v = xVar === "accelerationGNum" ? r.accelerationGNum : (r.angularVelocityNum ?? NaN);
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
      const key = getGroupKey(r, groupBy);
      const metric = agg === "avgAngular"
        ? (Number.isFinite(r.angularVelocityNum ?? NaN) ? (r.angularVelocityNum as number) : 0)
        : (Number.isFinite(r.accelerationGNum) ? r.accelerationGNum : 0);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(metric);
    }
    const data = Array.from(groups.entries()).map(([name, arr]) => {
      if (agg === "avg" || agg === "avgAngular") {
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
          <Bar dataKey="value" name={agg === "avg" ? "Avg acceleration (g)" : agg === "avgAngular" ? "Avg ω (°/s)" : "Count"} fill="#8b5cf6" />
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
              const color = PIE_COLORS[idx % PIE_COLORS.length];
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


