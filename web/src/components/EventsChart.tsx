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
  binCount?: number;
}) {
  const { rows, chartType, xVar, yVar, groupBy, agg = "count", binCount = 20 } = props;

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

  const COLORS = ["#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4","#84cc16","#f472b6","#f97316","#22c55e"];

  if (chartType === "histogram" && xVar) {
    // For accelerationG, use fixed bins: 0-30, 31-60, 61+
    if (xVar === "accelerationGNum") {
      const buckets = [
        { bucket: "0–30", count: 0 },
        { bucket: "31–60", count: 0 },
        { bucket: "61+", count: 0 },
      ];
      for (const r of rows) {
        const v = r.accelerationGNum;
        if (!Number.isFinite(v)) continue;
        if (v <= 30) buckets[0].count += 1;
        else if (v <= 60) buckets[1].count += 1;
        else buckets[2].count += 1;
      }
      return (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={buckets}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
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
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="bucket" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    // Default numeric binning for time-based histograms
    const data = buildHistogram(xVar, binCount);
    const formatted = data.map(d => ({
      bucket: `${Number.isFinite(d.x0) ? (d.x0 as number).toFixed(1) : d.x0}–${Number.isFinite(d.x1) ? (d.x1 as number).toFixed(1) : d.x1}`,
      count: d.count,
    }));
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={formatted}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="bucket" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" fill="#3b82f6" />
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
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Bar dataKey="value" name={agg === "avg" ? "Avg acceleration (g)" : "Count"} fill="#10b981" />
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
            {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  return <div className="text-sm text-gray-600">Unsupported chart configuration.</div>;
}

export default EventsChart;


