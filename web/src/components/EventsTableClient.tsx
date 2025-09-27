"use client";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";

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

  if (!data) return <div className="p-4">Loading…</div>;

  return (
    <div className="p-4">
      <h1 className="text-4xl font-bold mb-6 text-center">Concussion Events</h1>
      <div className="">
        <button
          type="button"
          className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="filters-panel"
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
      </div>
      {showFilters && (
      <div id="filters-panel" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-4 mb-4 items-end">
        <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Player" value={urlState.playerName} onChange={e=>setUrlState(s=>({ ...s, playerName: e.target.value }))} />
        <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Team" value={urlState.team} onChange={e=>setUrlState(s=>({ ...s, team: e.target.value }))} />
        <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Min accel (m/s^2)" value={urlState.accelMin} onChange={e=>setUrlState(s=>({ ...s, accelMin: e.target.value }))} />
        <input className="border rounded px-1 py-1 text-sm h-8 w-full" placeholder="Max accel (m/s^2)" value={urlState.accelMax} onChange={e=>setUrlState(s=>({ ...s, accelMax: e.target.value }))} />
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

      <div className="overflow-x-auto border rounded mt-4">
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
    </div>
  );
}
