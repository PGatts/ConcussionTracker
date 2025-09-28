"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import dynamic from "next/dynamic";
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
};

function useUrlState() {
  const [state, setState] = React.useState(() => {
    const sp = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    return {
      playerName: sp.get("playerName") || "",
      team: sp.get("team") || "",
      accelMin: sp.get("accelMin") || "",
      accelMax: sp.get("accelMax") || "",
      timeFrom: sp.get("timeFrom") || "",
      timeTo: sp.get("timeTo") || "",
      sortBy: (sp.get("sortBy") as "occurredAt" | "accelerationG") || "occurredAt",
      order: (sp.get("order") as "asc" | "desc") || "desc",
      // chart config
      chartType: (sp.get("chartType") as "histogram" | "bar" | "pie") || "histogram",
      xVar: (sp.get("xVar") as "accelerationG" | "occurredAt") || "accelerationG",
      yVar: (sp.get("yVar") as "accelerationG" | "occurredAt") || "occurredAt",
      groupBy: (sp.get("groupBy") as "team" | "playerName") || "team",
      agg: (sp.get("agg") as "count" | "sum" | "avg") || "count",
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
  const { data } = useQuery({
    queryKey: ["events-all"],
    queryFn: async () => {
      const res = await fetch(`/api/events?limit=100000`);
      const json = await res.json();
      return json.data as Event[];
    },
    staleTime: 60_000,
  });

  const [sorting, setSorting] = React.useState<SortingState>(
    urlState.sortBy ? [{ id: urlState.sortBy, desc: urlState.order === "desc" }] : []
  );

  const columns = React.useMemo<ColumnDef<Event>[]>(() => [
    { accessorKey: "id", header: "Event ID" },
    { accessorKey: "playerName", header: "Player" },
    { accessorKey: "team", header: "Team" },
    { accessorKey: "occurredAt", header: "Time",
      cell: ({ getValue }) => new Date(getValue<string>()).toLocaleString() },
    { accessorKey: "accelerationG", header: "Acceleration (g)",
      cell: ({ getValue }) => {
        const v = Number(getValue<number | string>());
        return Number.isFinite(v) ? v.toFixed(1) : "";
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

  const chartRows = React.useMemo(() => {
    return (filtered ?? [])
      .map(r => ({
        ...r,
        accelerationGNum: Number((r as any).accelerationG),
        occurredAtMs: Date.parse(r.occurredAt),
      }))
      .filter(r => Number.isFinite((r as any).accelerationGNum) && Number.isFinite((r as any).occurredAtMs));
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

  React.useEffect(() => {
    if (sorting[0]) {
      setUrlState(s => ({ ...s, sortBy: (sorting[0].id === "occurredAt" || sorting[0].id === "accelerationG") ? (sorting[0].id as "occurredAt" | "accelerationG") : "occurredAt", order: sorting[0].desc ? "desc" : "asc" }));
    }
  }, [sorting, setUrlState]);

  // Coerce unsupported agg options when switching chart types so the select has valid value
  React.useEffect(() => {
    setUrlState(s => {
      if ((s as any).chartType === "pie" && (s as any).agg === "avg") {
        return { ...s, agg: "count" as any };
      }
      if ((s as any).chartType === "bar" && (s as any).agg === "sum") {
        return { ...s, agg: "avg" as any };
      }
      return s;
    });
  }, [(urlState as any).chartType, setUrlState]);

  if (!data) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4">
      <h1 className="text-4xl font-bold mb-6 text-center">Concussion Events</h1>
      

      

      <div className={`mt-8 border rounded p-4 ${!showTable ? 'flex flex-col justify-center min-h-[120px]' : ''}`}>
        <div className="flex items-center justify-between mb-3 relative">
          <h3 className="text-xl font-semibold">Table</h3>
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
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
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
              onClick={() => setShowTable(v => !v)}
              aria-expanded={showTable}
              aria-controls="events-table"
            >
              {showTable ? "Hide table" : "Show table"}
            </button>
          </div>
        </div>
        {showFilters && (
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
        )}
        {showTable && (
        <div id="events-table" className="overflow-x-auto overflow-y-auto max-h-[520px]">
          <table className="min-w-full text-sm table-fixed">
          <thead className="bg-gray-50">
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={`text-left px-3 py-2 cursor-pointer select-none border-r border-gray-200 ${
                      h.column.id === 'id'
                        ? 'w-40 sm:w-64 lg:w-80 whitespace-nowrap'
                        : h.column.id === 'occurredAt'
                        ? 'w-40 sm:w-56 lg:w-64 whitespace-nowrap'
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
              <tr key={r.id} className="odd:bg-white even:bg-gray-50">
                {r.getVisibleCells().map((c) => (
                  <td
                    key={c.id}
                    className={`px-3 py-2 border-r border-gray-200 ${
                      c.column.id === 'id'
                        ? 'w-40 sm:w-64 lg:w-80 whitespace-nowrap'
                        : c.column.id === 'occurredAt'
                        ? 'w-40 sm:w-56 lg:w-64 whitespace-nowrap'
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
            <h2 className="text-xl font-semibold">Chart</h2>
          <div className="flex items-center gap-4">
            <div
              id="chart-options"
              className={`${showChartOptions ? 'grid' : 'grid invisible'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4 items-start`}
              aria-hidden={!showChartOptions}
            >
              <div className="flex flex-col gap-1">
                <span className="text-sm text-gray-600">Chart type</span>
                <select
                  className="border rounded px-1 py-1 text-sm h-8 w-full"
                  value={(urlState as any).chartType}
                  onChange={e => setUrlState(s => ({ ...s, chartType: e.target.value as any }))}
                >
                  <option value="histogram">Histogram</option>
                  <option value="bar">Bar</option>
                  <option value="pie">Pie</option>
                </select>
              </div>

              {(urlState as any).chartType === "histogram" && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">X axis</span>
                  <select
                    className="border rounded px-1 py-1 text-sm h-8 w-full"
                    value={(urlState as any).xVar}
                    onChange={e => setUrlState(s => ({ ...s, xVar: e.target.value as any }))}
                  >
                    <option value="accelerationG">Acceleration (g)</option>
                    <option value="occurredAt">Time</option>
                  </select>
                </div>
              )}

              {(urlState as any).chartType === "histogram" && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-gray-600">Bin count</span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="border rounded px-1 py-1 text-sm h-8 w-full"
                    value={(urlState as any).binCount}
                    onChange={e => setUrlState(s => ({ ...s, binCount: e.target.value }))}
                  />
                </div>
              )}

              {((urlState as any).chartType === "bar" || (urlState as any).chartType === "pie") && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-gray-600">Group by</span>
                    <select
                      className="border rounded px-1 py-1 text-sm h-8 w-full"
                      value={(urlState as any).groupBy}
                      onChange={e => setUrlState(s => ({ ...s, groupBy: e.target.value as any }))}
                    >
                      <option value="team">Team</option>
                      <option value="playerName">Player</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-gray-600">Aggregation</span>
                    <select
                      className="border rounded px-1 py-1 text-sm h-8 w-full"
                      value={(urlState as any).agg}
                      onChange={e => setUrlState(s => ({ ...s, agg: e.target.value as any }))}
                    >
                      <option value="count">Count</option>
                      {(urlState as any).chartType === "pie" ? (
                        <option value="sum">Sum of g</option>
                      ) : (
                        <option value="avg">Avg g</option>
                      )}
                    </select>
                  </div>
                </>
              )}
            </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
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
              className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
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
        <EventsChart
          rows={chartRows as any}
          chartType={(urlState as any).chartType as any}
          xVar={((urlState as any).xVar === "occurredAt" ? "occurredAtMs" : "accelerationGNum") as any}
          yVar={((urlState as any).yVar === "occurredAt" ? "occurredAtMs" : "accelerationGNum") as any}
          groupBy={(urlState as any).groupBy as any}
          agg={(urlState as any).agg as any}
          binCount={Number((urlState as any).binCount) || 20}
        />
        )}
      </div>
    </div>
  );
}
