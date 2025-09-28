"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import * as htmlToImage from "html-to-image";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";

const EventsChart = dynamic(() => import("./EventsChart"), { ssr: false });

type Event = {
  id: string;
  playerName: string;
  team?: string | null;
  occurredAt: string;
  accelerationG: number;
  angularVelocity: number;
};

type ChartType = "histogram" | "bar" | "pie";
type XVar = "accelerationG" | "angularVelocity" | "occurredAt";
type GroupBy = "team" | "playerName";
type Agg = "count" | "sum" | "avg";

type UrlState = {
  playerName: string;
  team: string;
  accelMin: string;
  accelMax: string;
  timeFrom: string;
  timeTo: string;
  sortBy: "occurredAt" | "accelerationG" | "angularVelocity";
  order: "asc" | "desc";
  chartType: ChartType;
  xVar: XVar;
  yVar: XVar;
  groupBy: GroupBy;
  agg: Agg;
  binCount: string;
};

function useUrlState() {
  const [state, setState] = React.useState<UrlState>(() => {
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return {
      playerName: sp.get("playerName") || "",
      team: sp.get("team") || "",
      accelMin: sp.get("accelMin") || "",
      accelMax: sp.get("accelMax") || "",
      timeFrom: sp.get("timeFrom") || "",
      timeTo: sp.get("timeTo") || "",
      sortBy: (sp.get("sortBy") as UrlState["sortBy"]) || "occurredAt",
      order: (sp.get("order") as "asc" | "desc") || "desc",
      // chart config
      chartType: (sp.get("chartType") as ChartType) || "histogram",
      xVar: (sp.get("xVar") as XVar) || "accelerationG",
      yVar: (sp.get("yVar") as XVar) || "occurredAt",
      groupBy: (sp.get("groupBy") as GroupBy) || "team",
      agg: (sp.get("agg") as Agg) || "count",
      binCount: sp.get("binCount") || "20",
    };
  });

  React.useEffect(() => {
    const sp = new URLSearchParams();
    Object.entries(state).forEach(([k,v]) => { if (v) sp.set(k, String(v)); });
    const url = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", url);
  }, [state]);

  return [state, setState] as const;
}

export function EventsTableClient() {
  const [urlState, setUrlState] = useUrlState();
  const [showFilters, setShowFilters] = React.useState(false);
  const [showTable, setShowTable] = React.useState(true);
  const [showChart, setShowChart] = React.useState(true);
  const [showChartOptions, setShowChartOptions] = React.useState(false);
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const [profilePlayer, setProfilePlayer] = React.useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["events-all"],
    queryFn: async () => {
      const res = await fetch(`/api/events?limit=100000`);
      const json = await res.json();
      return json.data as Event[];
    },
    staleTime: 60_000,
  });

  // Quick filter helpers
  function formatDateInput(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function setQuickTime(days: number): void {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - days);
    setUrlState((s) => ({ ...s, timeFrom: formatDateInput(from), timeTo: formatDateInput(now) }));
  }

  function clearQuickTime(): void {
    setUrlState((s) => ({ ...s, timeFrom: "", timeTo: "" }));
  }

  function isQuickTimeActive(days: number): boolean {
    if (!urlState.timeFrom || !urlState.timeTo) return false;
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - days);
    return urlState.timeFrom === formatDateInput(from) && urlState.timeTo === formatDateInput(now);
  }

  type AccelPreset = "mild" | "moderate" | "dangerous";

  function setQuickAccel(preset: AccelPreset): void {
    if (preset === "mild") {
      setUrlState((s) => ({ ...s, accelMin: "0", accelMax: "30" }));
    } else if (preset === "moderate") {
      setUrlState((s) => ({ ...s, accelMin: "31", accelMax: "60" }));
    } else {
      setUrlState((s) => ({ ...s, accelMin: "61", accelMax: "" }));
    }
  }

  function clearQuickAccel(): void {
    setUrlState((s) => ({ ...s, accelMin: "", accelMax: "" }));
  }

  function isQuickAccelActive(preset: AccelPreset): boolean {
    if (preset === "mild") return urlState.accelMin === "0" && urlState.accelMax === "30";
    if (preset === "moderate") return urlState.accelMin === "31" && urlState.accelMax === "60";
    return urlState.accelMin === "61" && urlState.accelMax === "";
  }

  const [sorting, setSorting] = React.useState<SortingState>(
    urlState.sortBy ? [{ id: urlState.sortBy, desc: urlState.order === "desc" }] : []
  );

  const columns = React.useMemo<ColumnDef<Event>[]>(() => [
    { accessorKey: "id", header: "Event ID" },
    { accessorKey: "playerName", header: "Player",
      cell: ({ getValue }) => {
        const name = getValue<string>();
        return (
          <button
            type="button"
            className="text-blue-700 hover:underline"
            onClick={() => setProfilePlayer(name)}
            aria-label={`Open profile for ${name}`}
          >
            {name}
          </button>
        );
      }
    },
    { accessorKey: "team", header: "Team" },
    { accessorKey: "occurredAt", header: "Time",
      cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    { accessorKey: "accelerationG", header: "Acceleration (g)",
      cell: ({ getValue }) => {
        const v = Number(getValue<number | string>());
        return Number.isFinite(v) ? v.toFixed(1) : "";
      }
    },
    { accessorKey: "angularVelocity", header: "Angular Velocity (°/s)",
      cell: ({ row }) => {
        const v = row.original.angularVelocity;
        return v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v).toFixed(1) : "";
      }
    },
  ], []);

  const filtered = React.useMemo(() => {
    let rows = data ?? [];
    if (urlState.playerName) {
      const q = urlState.playerName.toLowerCase();
      rows = rows.filter(r => r.playerName.toLowerCase().includes(q));
    }
    if (urlState.team) {
      rows = rows.filter(r => (r.team || "").toLowerCase() === urlState.team.toLowerCase());
    }
    if (urlState.accelMin) {
      const v = Number(urlState.accelMin);
      if (!Number.isNaN(v)) rows = rows.filter(r => r.accelerationG >= v);
    }
    if (urlState.accelMax) {
      const v = Number(urlState.accelMax);
      if (!Number.isNaN(v)) rows = rows.filter(r => r.accelerationG <= v);
    }
    if ((urlState as any).angularMin) {
      const v = Number((urlState as any).angularMin);
      if (!Number.isNaN(v)) rows = rows.filter(r => r.angularVelocity >= v);
    }
    if ((urlState as any).angularMax) {
      const v = Number((urlState as any).angularMax);
      if (!Number.isNaN(v)) rows = rows.filter(r => r.angularVelocity <= v);
    }
    if (urlState.timeFrom) {
      const fromStr = urlState.timeFrom.includes("T") ? urlState.timeFrom : `${urlState.timeFrom}T00:00:00`;
      const v = Date.parse(fromStr);
      if (!Number.isNaN(v)) rows = rows.filter(r => Date.parse(r.occurredAt) >= v);
    }
    if (urlState.timeTo) {
      const toStr = urlState.timeTo.includes("T") ? urlState.timeTo : `${urlState.timeTo}T00:00:00`;
      const end = Date.parse(toStr);
      if (!Number.isNaN(end)) {
        const endOfDay = end + 24 * 60 * 60 * 1000 - 1;
        rows = rows.filter(r => Date.parse(r.occurredAt) <= endOfDay);
      }
    }
    return rows;
  }, [data, urlState]);

  type ChartRow = Event & { accelerationGNum: number; occurredAtMs: number };
  const chartRows = React.useMemo<ChartRow[]>(() => {
    return (filtered ?? [])
      .map((r) => ({
        ...r,
        accelerationGNum: Number(r.accelerationG),
        occurredAtMs: Date.parse(r.occurredAt),
        angularVelocityNum: Number(r.angularVelocity),
      }))
      .filter((r) => Number.isFinite(r.accelerationGNum) && Number.isFinite(r.occurredAtMs));
  }, [filtered]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  function formatCell(columnId: string, value: unknown): string {
    if (columnId === "occurredAt" && typeof value === "string") {
      return new Date(value).toLocaleString();
    }
    if (columnId === "accelerationG") {
      const num = typeof value === "number" ? value : Number(value);
      return Number.isFinite(num) ? num.toFixed(1) : "";
    }
    return `${value ?? ""}`;
  }

  type ColumnAccessor = { accessorKey?: string };
  function exportCsv(): void {
    const visibleRows = table.getRowModel().rows;
    const headers = columns.map((c) => (typeof c.header === "string" ? c.header : String((c as ColumnAccessor).accessorKey ?? "")));
    const accessorKeys = columns.map((c) => String((c as ColumnAccessor).accessorKey ?? ""));
    const lines: string[] = [];
    const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
    lines.push(headers.map(escape).join(","));
    for (const r of visibleRows) {
      const obj = r.original as Event;
      const row = accessorKeys.map((k) => {
        const v = (obj as Record<string, unknown>)[k];
        return escape(formatCell(k, v));
      });
      lines.push(row.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "concussion-events.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportXlsx(): Promise<void> {
    const XLSX = await import("xlsx");
    const visibleRows = table.getRowModel().rows;
    const rows = visibleRows.map(r => r.original as Event).map((e) => ({
      "Event ID": e.id,
      "Player": e.playerName,
      "Team": e.team ?? "",
      "Time": new Date(e.occurredAt).toLocaleString(),
      "Acceleration (g)": Number.isFinite(Number(e.accelerationG)) ? Number(e.accelerationG).toFixed(1) : "",
      "Angular Velocity (°/s)": Number.isFinite(Number(e.angularVelocity)) ? Number(e.angularVelocity).toFixed(1) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Events");
    XLSX.writeFile(wb, "concussion-events.xlsx");
  }

  async function exportChartPng(): Promise<void> {
    if (!chartRef.current) return;
    try {
      const dataUrl = await htmlToImage.toPng(chartRef.current, {
        pixelRatio: 2,
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "chart.png";
      a.click();
    } catch (e) {
      const svg = chartRef.current.querySelector('svg');
      if (svg) {
        const dataUrl = await htmlToImage.toPng(svg as unknown as HTMLElement, {
          pixelRatio: 2,
          cacheBust: true,
        });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "chart.png";
        a.click();
      }
    }
  }

  async function exportChartSvg(): Promise<void> {
    if (!chartRef.current) return;
    try {
      const dataUrl = await htmlToImage.toSvg(chartRef.current, { cacheBust: true });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "chart.svg";
      a.click();
    } catch (e) {
      const svg = chartRef.current.querySelector('svg');
      if (svg) {
        const dataUrl = await htmlToImage.toSvg(svg as unknown as HTMLElement, { cacheBust: true });
        const a = document.createElement("a");
        a.href = dataUrl;
        a.download = "chart.svg";
        a.click();
      }
    }
  }

  React.useEffect(() => {
    if (sorting[0]) {
      setUrlState(s => ({ ...s, sortBy: (sorting[0].id === "occurredAt" || sorting[0].id === "accelerationG") ? (sorting[0].id as "occurredAt" | "accelerationG") : "occurredAt", order: sorting[0].desc ? "desc" : "asc" }));
    }
  }, [sorting, setUrlState]);

  // Close player modal on Escape
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setProfilePlayer(null);
      }
    }
    if (profilePlayer) {
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
    return undefined;
  }, [profilePlayer]);

  // Coerce unsupported agg options when switching chart types so the select has valid value
  React.useEffect(() => {
    setUrlState((s) => {
      if (s.chartType === "pie" && s.agg === "avg") {
        return { ...s, agg: "count" };
      }
      if (s.chartType === "bar" && s.agg === "sum") {
        return { ...s, agg: "avg" };
      }
      return s;
    });
  }, [urlState.chartType, setUrlState]);

  if (!data) return (
    <div className="p-8 flex items-center justify-center min-h-[60vh]">
      <div className="relative inline-block">
        <div className="w-16 h-16 rounded-full border-4 border-blue-400 border-t-transparent animate-spin" />
        <div className="absolute inset-0 w-16 h-16 rounded-full border-4 border-blue-300 border-b-transparent animate-[spin_1.5s_linear_infinite]" />
      </div>
    </div>
  );

  return (
    <div className="p-4">
      <div className="flex items-center justify-center mb-4">
        <img src="/logo.png" alt="Happy Head" className="h-40 sm:h-56 md:h-72 object-contain" />
      </div>
      
      

      <div className="mt-6 mb-2 text-gray-800">
        <p className="text-lg">
          This dashboard helps detect and track potentially concussive hits by listing measured impact events
          with player, team, time, and acceleration (g). Use filters and quick presets to focus on time ranges
          and severity bands, or click a player to see their history and stats.
          <a href="/about" className="ml-2 text-blue-700 hover:underline">Learn more about how to interpret these metrics ↗</a>
        </p>
      </div>
      <div className={`border rounded p-4 ${!showTable ? 'flex flex-col justify-center min-h-[120px]' : ''}`}>
        <div className="flex items-center justify-between mb-3 relative">
          <h3 className="text-3xl font-extrabold font-sans tracking-tight text-violet-800">Table</h3>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-controls="table-filters"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M3 5.25A.75.75 0 0 1 3.75 4.5h16.5a.75.75 0 0 1 .53 1.28L15 11.06v6.69a.75.75 0 0 1-1.1.67l-3-1.5a.75.75 0 0 1-.4-.67v-5.19L3.22 5.78A.75.75 0 0 1 3 5.25Z" />
              </svg>
              {showFilters ? "Hide filters" : "Show filters"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={() => setShowTable(v => !v)}
              aria-expanded={showTable}
              aria-controls="events-table"
            >
              {showTable ? "Hide table" : "Show table"}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={exportCsv}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={exportXlsx}
            >
              Export Excel
            </button>
          </div>
        </div>
        {showFilters && (
          <>
          <div className="mb-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-medium text-gray-800">Quick time:</span>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickTimeActive(7) ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickTime(7)}
              >
                Last 7 days
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickTimeActive(30) ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickTime(30)}
              >
                Last 30 days
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickTimeActive(90) ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickTime(90)}
              >
                Last 90 days
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full text-base border border-orange-500 bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                onClick={clearQuickTime}
              >
                Clear
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-base font-medium text-gray-800">Quick accel:</span>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickAccelActive('mild') ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickAccel('mild')}
              >
                0–30 (Mild)
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickAccelActive('moderate') ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickAccel('moderate')}
              >
                31–60 (Moderate)
              </button>
              <button
                type="button"
                className={`px-3 py-2 rounded-full text-base border transition-colors ${isQuickAccelActive('dangerous') ? 'border-blue-600 bg-blue-100 text-blue-900' : 'border-blue-500 text-blue-800 hover:bg-blue-50'}`}
                onClick={() => setQuickAccel('dangerous')}
              >
                61+ (Dangerous)
              </button>
              <button
                type="button"
                className="px-3 py-2 rounded-full text-base border border-orange-500 bg-orange-500 text-white hover:bg-orange-600 transition-colors"
                onClick={clearQuickAccel}
              >
                Clear
              </button>
            </div>
          </div>
          <div id="table-filters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4 mb-4 items-end">
            <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Player" value={urlState.playerName} onChange={e=>setUrlState(s=>({ ...s, playerName: e.target.value }))} />
            <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Team" value={urlState.team} onChange={e=>setUrlState(s=>({ ...s, team: e.target.value }))} />
            <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Min accel (g)" value={urlState.accelMin} onChange={e=>setUrlState(s=>({ ...s, accelMin: e.target.value }))} />
            <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Max accel (g)" value={urlState.accelMax} onChange={e=>setUrlState(s=>({ ...s, accelMax: e.target.value }))} />
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">From</span>
              <input type="date" className="border rounded px-1 py-1 text-sm h-8 w-full" value={urlState.timeFrom} onChange={e=>setUrlState(s=>({ ...s, timeFrom: e.target.value }))} />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm text-gray-600">To</span>
              <input type="date" className="border rounded px-1 py-1 text-sm h-8 w-full" value={urlState.timeTo} onChange={e=>setUrlState(s=>({ ...s, timeTo: e.target.value }))} />
            </div>
          </div>
          </>
        )}
        {showTable && (
        <div id="events-table" className="overflow-x-auto overflow-y-auto max-h-[520px]">
          <table className="min-w-full text-sm table-fixed border border-violet-200">
          <thead className="bg-violet-200 text-violet-900 sticky top-0 z-10">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={`text-left px-3 py-2 cursor-pointer select-none border-r border-violet-200 font-medium text-violet-900 text-base sm:text-lg ${
                      h.column.id === 'id'
                        ? 'w-40 sm:w-64 lg:w-80 whitespace-nowrap'
                        : h.column.id === 'occurredAt'
                        ? 'w-40 sm:w-56 lg:w-64 whitespace-nowrap'
                        : h.column.id === 'accelerationG'
                        ? 'w-44 sm:w-56 lg:w-64 whitespace-nowrap'
                        : h.column.id === 'angularVelocity'
                        ? 'w-56 sm:w-72 lg:w-80 whitespace-nowrap'
                        : h.column.id === 'team' || h.column.id === 'playerName'
                        ? 'w-56 sm:w-80 lg:w-96'
                        : ''
                    }`}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map(r => (
              <tr key={r.id} className="odd:bg-yellow-50 even:bg-violet-50 hover:bg-violet-100">
                {r.getVisibleCells().map((c) => (
                  <td
                    key={c.id}
                    className={`px-3 py-2 border-r border-violet-200 ${
                      c.column.id === 'id'
                        ? 'w-40 sm:w-64 lg:w-80 whitespace-nowrap'
                        : c.column.id === 'occurredAt'
                        ? 'w-40 sm:w-56 lg:w-64 whitespace-nowrap'
                        : c.column.id === 'accelerationG'
                        ? 'w-44 sm:w-56 lg:w-64 whitespace-nowrap'
                        : c.column.id === 'angularVelocity'
                        ? 'w-56 sm:w-72 lg:w-80 whitespace-nowrap'
                        : c.column.id === 'team' || c.column.id === 'playerName'
                        ? 'w-56 sm:w-80 lg:w-96'
                        : ''
                    }`}
                  >
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          </table>
        </div>
        )}
      </div>

      <div className="mt-8 border rounded p-4">
        <div className={`${!showChart ? 'flex flex-col justify-center min-h-[120px]' : ''}`}>
          <div className="flex items-center justify-between mb-3 relative">
            <h2 className="text-3xl font-extrabold font-sans tracking-tight text-violet-800">Chart</h2>
          <div className="flex items-center gap-4">
            <div
              id="chart-options"
              className={`${showChartOptions ? 'grid' : 'grid invisible'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-start`}
              aria-hidden={!showChartOptions}
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm text-yellow-900">Chart type</span>
                <select
                  className="border border-yellow-300 bg-yellow-50 rounded px-1 py-1 text-sm h-8 w-full text-yellow-900"
          value={urlState.chartType}
                  onChange={e => setUrlState(s => ({ ...s, chartType: e.target.value as ChartType }))}
                >
                  <option value="histogram">Histogram</option>
                  <option value="bar">Bar</option>
                  <option value="pie">Pie</option>
                </select>
              </div>

              {urlState.chartType === "histogram" && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-yellow-900">X axis</span>
                  <select
                    className="border border-yellow-300 bg-yellow-50 rounded px-1 py-1 text-sm h-8 w-full text-yellow-900"
                    value={urlState.xVar}
                    onChange={e => setUrlState(s => ({ ...s, xVar: e.target.value as XVar }))}
                  >
                    <option value="accelerationG">Acceleration (g)</option>
                    <option value="angularVelocity">Angular Velocity (°/s)</option>
                    <option value="occurredAt">Time</option>
                  </select>
                </div>
              )}

              

              {(urlState.chartType === "bar" || urlState.chartType === "pie") && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-yellow-900">Group by</span>
                    <select
                      className="border border-yellow-300 bg-yellow-50 rounded px-1 py-1 text-sm h-8 w-full text-yellow-900"
                      value={urlState.groupBy}
                      onChange={e => setUrlState(s => ({ ...s, groupBy: e.target.value as GroupBy }))}
                    >
                      <option value="team">Team</option>
                      <option value="playerName">Player</option>
                      {urlState.chartType === "bar" && (<option value="timeYear">Time (year)</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-yellow-900">Aggregation</span>
                    <select
                      className="border border-yellow-300 bg-yellow-50 rounded px-1 py-1 text-sm h-8 w-full text-yellow-900"
                      value={urlState.agg}
                      onChange={e => setUrlState(s => ({ ...s, agg: e.target.value as Agg }))}
                    >
                      <option value="count">Count</option>
                      {urlState.chartType === "pie" ? (
                        <>
                          <option value="sum">Sum of g</option>
                          <option value="sumOmega">Sum ω (°/s)</option>
                        </>
                      ) : (
                        <option value="avg">Avg g</option>
                      )}
                      {urlState.chartType === "bar" && (<option value="avgAngular">Avg ω (°/s)</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
            onClick={() => setShowChartOptions(v => !v)}
            aria-expanded={showChartOptions}
            aria-controls="chart-options"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <rect x="4" y="11" width="3" height="7" rx="0.5" />
              <rect x="10.5" y="6" width="3" height="12" rx="0.5" />
              <rect x="17" y="14" width="3" height="4" rx="0.5" />
            </svg>
            {showChartOptions ? "Hide chart options" : "Show chart options"}
          </button>
            <button
              type="button"
            className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={exportChartPng}
            >
              Export PNG
            </button>
            <button
              type="button"
            className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={exportChartSvg}
            >
              Export SVG
            </button>
            <button
              type="button"
            className="inline-flex items-center gap-2 text-sm text-violet-700 hover:text-violet-800"
              onClick={() => setShowChart(v => !v)}
              aria-expanded={showChart}
              aria-controls="events-chart"
            >
              {showChart ? "Hide chart" : "Show chart"}
            </button>
          </div>
          {/* options now inline to the left of the toggle button */}
          </div>
        </div>
        {showChart && (
          (() => {
            const xVarKey: "occurredAtMs" | "accelerationGNum" = urlState.xVar === "occurredAt" ? "occurredAtMs" : "accelerationGNum";
            const yVarKey: "occurredAtMs" | "accelerationGNum" | "angularVelocityNum" =
              urlState.yVar === "occurredAt" ? "occurredAtMs" : (urlState.yVar === "accelerationG" ? "accelerationGNum" : "angularVelocityNum");
            return (
              <div ref={chartRef} id="events-chart" className="w-full bg-gradient-to-r from-blue-200 via-blue-300 to-blue-200 rounded">
                <EventsChart
                  rows={chartRows}
                  chartType={urlState.chartType}
                  xVar={xVarKey as any}
                  yVar={yVarKey as any}
                  groupBy={urlState.groupBy}
                  agg={urlState.agg}
                />
              </div>
            );
          })()
        )}
      </div>

      {/* Player Profile Modal */}
      {profilePlayer && (
        <div role="dialog" aria-modal="true" aria-label={`${profilePlayer} profile`} className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setProfilePlayer(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4">
            <div className="flex items-center justify-between border-b px-6 py-5">
              <div className="space-y-2">
                <h3 className="text-2xl font-bold text-blue-900">{profilePlayer}</h3>
                <PlayerMeta name={profilePlayer} events={data ?? []} />
              </div>
              <button
                type="button"
                className="text-gray-600 hover:text-gray-800 text-4xl leading-none mr-2"
                aria-label="Close"
                onClick={() => setProfilePlayer(null)}
              >
                ×
              </button>
            </div>
            <div className="px-6 py-5 max-h-[70vh] overflow-auto">
              <PlayerEventsTable name={profilePlayer} events={data ?? []} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

// Helper components

type PlayerMetaProps = { name: string; events: Event[] };
function PlayerMeta({ name, events }: PlayerMetaProps) {
  const playerEvents = React.useMemo(() => events.filter(e => e.playerName === name), [events, name]);
  const teams = React.useMemo(() => {
    const uniq = Array.from(new Set(playerEvents.map(e => e.team).filter((t): t is string => Boolean(t))));
    return uniq;
  }, [playerEvents]);
  const mostRecent = React.useMemo(() => {
    if (playerEvents.length === 0) return "—";
    const latest = playerEvents.reduce((a, b) => (Date.parse(a.occurredAt) > Date.parse(b.occurredAt) ? a : b));
    return new Date(latest.occurredAt).toLocaleString();
  }, [playerEvents]);
  const { avgG, maxG, avgAV, maxAV } = React.useMemo(() => {
    if (playerEvents.length === 0) return { avgG: null as number | null, maxG: null as number | null, avgAV: null as number | null, maxAV: null as number | null };
    const gVals = playerEvents.map(e => Number(e.accelerationG)).filter(n => Number.isFinite(n));
    const avVals = playerEvents.map(e => Number((e as any).angularVelocity)).filter(n => Number.isFinite(n));
    const avgGVal = gVals.length ? gVals.reduce((a, b) => a + b, 0) / gVals.length : null;
    const maxGVal = gVals.length ? Math.max(...gVals) : null;
    const avgAVVal = avVals.length ? avVals.reduce((a, b) => a + b, 0) / avVals.length : null;
    const maxAVVal = avVals.length ? Math.max(...avVals) : null;
    return { avgG: avgGVal, maxG: maxGVal, avgAV: avgAVVal, maxAV: maxAVVal };
  }, [playerEvents]);
  return (
    <div className="text-sm text-gray-700 space-y-2">
      <div>
        <span className="mr-3"><span className="font-semibold">Team(s):</span> {teams.length ? teams.join(", ") : "—"}</span>
      </div>
      <div>
        <span className="mr-4"><span className="font-semibold">Collisions:</span> {playerEvents.length}</span>
        <span className="mr-4"><span className="font-semibold">Avg g:</span> {avgG !== null ? avgG.toFixed(1) : "—"}</span>
        <span className="mr-4"><span className="font-semibold">Max g:</span> {maxG !== null ? maxG.toFixed(1) : "—"}</span>
        <span className="mr-4"><span className="font-semibold">Avg ω (°/s):</span> {avgAV !== null ? avgAV.toFixed(1) : "—"}</span>
        <span className="mr-4"><span className="font-semibold">Max ω (°/s):</span> {maxAV !== null ? maxAV.toFixed(1) : "—"}</span>
        <span><span className="font-semibold">Most recent:</span> {mostRecent}</span>
      </div>
    </div>
  );
}

type PlayerEventsTableProps = { name: string; events: Event[] };
function PlayerEventsTable({ name, events }: PlayerEventsTableProps) {
  const rows = React.useMemo(() => events.filter(e => e.playerName === name).sort((a,b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)), [events, name]);
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm table-fixed border border-gray-200">
        <thead className="bg-gray-200 text-gray-900">
          <tr>
            <th className="text-left px-3 py-2 border-r border-gray-200">Event ID</th>
            <th className="text-left px-3 py-2 border-r border-gray-200">Team</th>
            <th className="text-left px-3 py-2 border-r border-gray-200">Time</th>
            <th className="text-left px-3 py-2">Acceleration (g)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="odd:bg-white even:bg-blue-50">
              <td className="px-3 py-2 border-r border-gray-200 whitespace-nowrap">{r.id}</td>
              <td className="px-3 py-2 border-r border-gray-200">{r.team ?? ""}</td>
              <td className="px-3 py-2 border-r border-gray-200 whitespace-nowrap">{new Date(r.occurredAt).toLocaleString()}</td>
              <td className="px-3 py-2">{Number(r.accelerationG).toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
