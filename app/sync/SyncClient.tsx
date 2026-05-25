"use client";

import { useState, useMemo } from "react";
import { RefreshCw, CheckCircle2, XCircle, Loader2, Clock, Download, X, Link2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────

interface SyncJob {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  message: string | null;
  stats: string | null;
}

interface ProductiveDeal {
  id: string;
  name: string;
  probability: number;
  startDate: string | null;
  endDate: string | null;
  stageStatus: "open" | "won" | "lost";
  clientName: string | null;
}

interface ExistingProject {
  id: string;
  name: string;
  clientName: string | null;
}

interface RowState {
  dealId: string;
  included: boolean;   // include in import
  selected: boolean;   // selected for group action
  name: string;
  linkToProjectId: string | null;
  groupKey: string | null;   // same key = merged into one project
  isPrimary: boolean;        // only the primary row creates a project
}

// ── Small helpers ────────────────────────────────────────────────────

const GROUP_COLORS = [
  "bg-violet-100 text-violet-700 border-violet-300",
  "bg-cyan-100 text-cyan-700 border-cyan-300",
  "bg-amber-100 text-amber-700 border-amber-300",
  "bg-rose-100 text-rose-700 border-rose-300",
  "bg-emerald-100 text-emerald-700 border-emerald-300",
];

function groupColor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ok" ? "bg-green-50 text-green-700" :
    status === "running" ? "bg-blue-50 text-blue-700" :
    "bg-red-50 text-red-700";
  const Icon = status === "running" ? Loader2 : status === "ok" ? CheckCircle2 : XCircle;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium", cls)}>
      <Icon className={cn("h-3.5 w-3.5", status === "running" && "animate-spin")} />
      {status}
    </span>
  );
}

function DealStatusBadge({ stageStatus }: { stageStatus: "open" | "won" | "lost" }) {
  return stageStatus === "won"
    ? <span className="rounded bg-green-50 px-1.5 py-0.5 text-xs font-medium text-green-700">Won</span>
    : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Pipeline</span>;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return d.slice(0, 7);
}

function duration(start: string, end: string | null) {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function fmtDatetime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Deals tab ────────────────────────────────────────────────────────

type Horizon = 3 | 6 | 12 | 0;

function DealsTab({ jobs, onJobsRefresh }: { jobs: SyncJob[]; onJobsRefresh: (j: SyncJob[]) => void }) {
  const [deals, setDeals] = useState<ProductiveDeal[] | null>(null);
  const [projects, setProjects] = useState<ExistingProject[]>([]);
  const [rows, setRows] = useState<RowState[]>([]);
  const [horizon, setHorizon] = useState<Horizon>(6);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  // Grouping state
  const [groupInputVisible, setGroupInputVisible] = useState(false);
  const [groupInputValue, setGroupInputValue] = useState("");

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  // Always filter out past deals; then apply horizon
  const visibleDeals = useMemo(() => {
    if (!deals) return [];
    return deals.filter((d) => {
      const end = d.endDate ? new Date(d.endDate) : null;
      const start = d.startDate ? new Date(d.startDate) : null;
      // Exclude if end date is in the past
      if (end && end < today) return false;
      // Exclude if no end date but start date is in the past
      // (e.g. "Q4 2024" deal with no end date set)
      if (!end && start && start < today) return false;
      if (horizon === 0) return true;
      const cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() + horizon);
      return !start || start <= cutoff;
    });
  }, [deals, horizon, today]);

  const visibleIds = useMemo(() => new Set(visibleDeals.map((d) => d.id)), [visibleDeals]);

  function patchRow(dealId: string, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r) => (r.dealId === dealId ? { ...r, ...patch } : r)));
  }

  // Rows currently selected (for group action), limited to visible
  const selectedRows = useMemo(
    () => rows.filter((r) => r.selected && visibleIds.has(r.dealId)),
    [rows, visibleIds]
  );

  // Rows included in import, limited to visible
  const includedCount = useMemo(
    () => rows.filter((r) => r.included && (r.groupKey === null || r.isPrimary) && visibleIds.has(r.dealId)).length,
    [rows, visibleIds]
  );

  function confirmGroup() {
    const name = groupInputValue.trim();
    if (!name || selectedRows.length < 2) return;
    const key = `g_${Date.now()}`;
    const ids = new Set(selectedRows.map((r) => r.dealId));
    let first = true;
    setRows((prev) =>
      prev.map((r) => {
        if (!ids.has(r.dealId)) return r;
        const out: RowState = { ...r, groupKey: key, isPrimary: first, selected: false };
        if (first) out.name = name;
        first = false;
        return out;
      })
    );
    setGroupInputValue("");
    setGroupInputVisible(false);
  }

  function ungroupRow(dealId: string) {
    const row = rows.find((r) => r.dealId === dealId);
    if (!row?.groupKey) return;
    const key = row.groupKey;
    setRows((prev) => {
      const inGroup = prev.filter((r) => r.groupKey === key);
      // If only 2 in group, dissolve the whole group; else just remove this row
      if (inGroup.length <= 2) {
        return prev.map((r) =>
          r.groupKey === key ? { ...r, groupKey: null, isPrimary: false, name: deals?.find((d) => d.id === r.dealId)?.name ?? r.name } : r
        );
      }
      // Remove from group; if it was primary, promote next
      let newPrimary = true;
      return prev.map((r) => {
        if (r.dealId === dealId) return { ...r, groupKey: null, isPrimary: false };
        if (r.groupKey === key && newPrimary) { newPrimary = false; return { ...r, isPrimary: true }; }
        return r;
      });
    });
  }

  // Group metadata
  const groupMeta = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const r of rows) {
      if (!r.groupKey) continue;
      if (!map.has(r.groupKey)) map.set(r.groupKey, { name: r.isPrimary ? r.name : "", count: 0 });
      const m = map.get(r.groupKey)!;
      m.count++;
      if (r.isPrimary) m.name = r.name;
    }
    return map;
  }, [rows]);

  async function loadDeals() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync/preview");
      if (!res.ok) throw new Error(await res.text());
      const data: { deals: ProductiveDeal[]; projects: ExistingProject[] } = await res.json();
      setDeals(data.deals);
      setProjects(data.projects);
      setRows(data.deals.map((d) => ({ dealId: d.id, included: true, selected: false, name: d.name, linkToProjectId: null, groupKey: null, isPrimary: false })));
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function importDeals() {
    const payload = rows
      .filter((r) => r.included && visibleIds.has(r.dealId) && (r.groupKey === null || r.isPrimary))
      .map((r) => {
        const deal = deals!.find((d) => d.id === r.dealId)!;
        return {
          dealId: r.dealId,
          name: r.name,
          clientName: deal.clientName,
          probability: deal.probability,
          stageStatus: deal.stageStatus,
          startDate: deal.startDate,
          endDate: deal.endDate,
          linkToProjectId: r.linkToProjectId,
        };
      });

    if (payload.length === 0) { setMsg({ type: "error", text: "No deals selected." }); return; }
    setImporting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (result.errors?.length) {
        setMsg({ type: "error", text: result.errors.join("\n") });
      } else {
        setMsg({ type: "ok", text: `Imported ${result.created} project(s), linked ${result.linked}.` });
        setDeals(null);
      }
      const listRes = await fetch("/api/sync");
      if (listRes.ok) onJobsRefresh(await listRes.json());
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setImporting(false);
    }
  }

  async function clearImported() {
    if (!confirm("Delete all projects imported from Productive? Their allocations will also be deleted.")) return;
    setClearing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync/deals", { method: "DELETE" });
      const { deleted } = await res.json();
      setMsg({ type: "ok", text: `Deleted ${deleted} imported project(s).` });
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={loadDeals}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {loading ? "Loading…" : deals ? "Reload from Productive" : "Load from Productive"}
        </button>

        {deals && (
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <span>Show next</span>
            {([3, 6, 12, 0] as Horizon[]).map((h) => (
              <button
                key={h}
                onClick={() => setHorizon(h)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium",
                  horizon === h ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100"
                )}
              >{h === 0 ? "All" : `${h}mo`}</button>
            ))}
          </div>
        )}

        {deals && (
          <span className="text-sm text-gray-400">
            {visibleDeals.length} deal{visibleDeals.length !== 1 ? "s" : ""}
          </span>
        )}

        <button
          onClick={clearImported}
          disabled={clearing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Clear imported deals
        </button>
      </div>

      {/* Group action bar */}
      {selectedRows.length >= 2 && (
        <div className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
          <Layers className="h-4 w-4 text-violet-600 shrink-0" />
          <span className="text-sm text-violet-700 font-medium">{selectedRows.length} deals selected</span>
          {groupInputVisible ? (
            <div className="flex items-center gap-2 ml-2">
              <input
                autoFocus
                type="text"
                placeholder="Group / project name…"
                value={groupInputValue}
                onChange={(e) => setGroupInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmGroup(); if (e.key === "Escape") setGroupInputVisible(false); }}
                className="rounded border border-violet-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 w-56"
              />
              <button onClick={confirmGroup} className="rounded bg-violet-600 px-3 py-1 text-sm font-medium text-white hover:bg-violet-700">Group</button>
              <button onClick={() => setGroupInputVisible(false)} className="text-violet-400 hover:text-violet-600"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button
              onClick={() => setGroupInputVisible(true)}
              className="ml-2 rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-white hover:bg-violet-700"
            >
              Group as one project…
            </button>
          )}
          <button
            onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: false })))}
            className="ml-auto text-violet-400 hover:text-violet-600"
          ><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Message */}
      {msg && (
        <div className={cn(
          "rounded-md border p-3 text-sm whitespace-pre-wrap font-mono",
          msg.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
        )}>
          {msg.text}
        </div>
      )}

      {/* Table */}
      {deals && visibleDeals.length === 0 && (
        <p className="text-sm text-gray-500">No active or upcoming deals match the selected window.</p>
      )}

      {visibleDeals.length > 0 && (
        <>
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="w-8 px-2 py-2" title="Select for grouping" />
                  <th className="w-8 px-2 py-2">
                    <input
                      type="checkbox"
                      title="Include all"
                      checked={rows.filter((r) => visibleIds.has(r.dealId)).every((r) => r.included)}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r) => visibleIds.has(r.dealId) ? { ...r, included: e.target.checked } : r)
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-2 text-left">Project name</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Dates</th>
                  <th className="px-3 py-2 text-right">Prob</th>
                  <th className="px-3 py-2 text-left">Stage</th>
                  <th className="px-3 py-2 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleDeals.map((deal) => {
                  const row = rows.find((r) => r.dealId === deal.id);
                  if (!row) return null;
                  const linked = projects.find((p) => p.id === row.linkToProjectId);
                  const gMeta = row.groupKey ? groupMeta.get(row.groupKey) : null;
                  const isNonPrimary = !!row.groupKey && !row.isPrimary;

                  return (
                    <tr
                      key={deal.id}
                      className={cn(
                        "hover:bg-gray-50",
                        !row.included && "opacity-40",
                        isNonPrimary && "bg-gray-50/60",
                        row.selected && "bg-violet-50"
                      )}
                    >
                      {/* Select for group */}
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          disabled={!!row.groupKey} // already grouped
                          title={row.groupKey ? "Already in a group" : "Select to group"}
                          onChange={(e) => patchRow(deal.id, { selected: e.target.checked })}
                          className="accent-violet-600"
                        />
                      </td>
                      {/* Include in import */}
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.included}
                          onChange={(e) => patchRow(deal.id, { included: e.target.checked })}
                        />
                      </td>
                      {/* Name */}
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          {gMeta && (
                            <span className={cn(
                              "shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium",
                              groupColor(row.groupKey!)
                            )}>
                              {row.isPrimary ? `+${gMeta.count - 1}` : "↳"}
                            </span>
                          )}
                          {row.isPrimary || !row.groupKey ? (
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => patchRow(deal.id, { name: e.target.value })}
                              disabled={!row.included}
                              className="w-full min-w-[160px] rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-gray-200 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:text-gray-400"
                            />
                          ) : (
                            <span className="text-sm text-gray-400 italic">{deal.name}</span>
                          )}
                          {row.groupKey && (
                            <button
                              onClick={() => ungroupRow(deal.id)}
                              title="Remove from group"
                              className="shrink-0 text-gray-300 hover:text-red-400"
                            ><X className="h-3 w-3" /></button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{deal.clientName ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs tabular-nums">
                        {fmtDate(deal.startDate)} → {fmtDate(deal.endDate)}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-600 tabular-nums">{deal.probability}%</td>
                      <td className="px-3 py-2"><DealStatusBadge stageStatus={deal.stageStatus} /></td>
                      <td className="px-3 py-2">
                        {isNonPrimary ? (
                          <span className="text-xs text-gray-400 italic">grouped</span>
                        ) : linked ? (
                          <div className="flex items-center gap-1">
                            <Link2 className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                            <span className="text-xs text-indigo-700 truncate max-w-[130px]">{linked.name}</span>
                            <button onClick={() => patchRow(deal.id, { linkToProjectId: null })} className="text-gray-400 hover:text-red-500 shrink-0"><X className="h-3 w-3" /></button>
                          </div>
                        ) : (
                          <select
                            value=""
                            onChange={(e) => e.target.value && patchRow(deal.id, { linkToProjectId: e.target.value })}
                            className="max-w-[160px] rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-500 focus:border-indigo-300 focus:outline-none"
                          >
                            <option value="">New project…</option>
                            <optgroup label="Link to existing">
                              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </optgroup>
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {includedCount} project{includedCount !== 1 ? "s" : ""} will be created
            </span>
            <button
              onClick={importDeals}
              disabled={importing || includedCount === 0}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {importing ? "Importing…" : `Import ${includedCount} project${includedCount !== 1 ? "s" : ""}`}
            </button>
          </div>
        </>
      )}

      {!deals && !loading && (
        <p className="text-sm text-gray-500">
          Click "Load from Productive" to preview deals before importing.
        </p>
      )}
    </div>
  );
}

// ── Projects tab ─────────────────────────────────────────────────────

interface RemoteProject {
  id: string;
  name: string;
  clientName: string | null;
  startDate: string | null;
  endDate: string | null;
}

interface LinkedPlannerProject {
  id: string;
  name: string;
  clientName: string | null;
  startWeekId: string;
  endWeekId: string;
  productiveProjectId: string;
  aliasIds: string[];  // other productive IDs grouped into this planner project
}

type ProjectSection = "linked" | "new" | "skipped";

interface ProjectRowState {
  productiveId: string;
  included: boolean;
  selected: boolean;
  hidden: boolean;        // true for non-primary group members (collapsed)
  name: string;
  section: ProjectSection;
  groupKey: string | null;
  isPrimary: boolean;
  plannerProjectId: string | null;  // set for "linked" section
  aliasIds: string[];               // productive IDs merged into this row
}

const SKIPPED_STORAGE_KEY = "cobe_skipped_project_ids";

function loadSkipped(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const s = localStorage.getItem(SKIPPED_STORAGE_KEY);
    return s ? new Set(JSON.parse(s) as string[]) : new Set();
  } catch { return new Set(); }
}

function saveSkipped(ids: Set<string>) {
  try { localStorage.setItem(SKIPPED_STORAGE_KEY, JSON.stringify([...ids])); } catch {}
}

function ProjectsTab({ jobs, onJobsRefresh }: { jobs: SyncJob[]; onJobsRefresh: (j: SyncJob[]) => void }) {
  const [remoteProjects, setRemoteProjects] = useState<RemoteProject[] | null>(null);
  const [linkedPlannerProjects, setLinkedPlannerProjects] = useState<LinkedPlannerProject[]>([]);
  const [rows, setRows] = useState<ProjectRowState[]>([]);
  const [horizon, setHorizon] = useState<Horizon>(6);
  const [importBookings, setImportBookings] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [groupInputVisible, setGroupInputVisible] = useState(false);
  const [groupInputValue, setGroupInputValue] = useState("");
  // Inline "add alias" input state: productiveId of the row being edited → current typed value
  const [aliasEditId, setAliasEditId] = useState<string | null>(null);
  const [aliasInputValue, setAliasInputValue] = useState("");

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);

  // All productive IDs that are already linked (primary + aliases) — excluded from time-filtered list
  const allLinkedIds = useMemo(() => {
    const s = new Set<string>();
    for (const lp of linkedPlannerProjects) {
      s.add(lp.productiveProjectId);
      for (const a of lp.aliasIds) s.add(a);
    }
    return s;
  }, [linkedPlannerProjects]);

  // Time-filtered non-linked projects only
  const filteredRemote = useMemo(() => {
    if (!remoteProjects) return [];
    return remoteProjects.filter((p) => {
      if (allLinkedIds.has(p.id)) return false;
      const end = p.endDate ? new Date(p.endDate) : null;
      const start = p.startDate ? new Date(p.startDate) : null;
      // Hide only if there's an explicit past end date — open-ended projects (no endDate) are always ongoing
      if (end && end < today) return false;
      if (horizon === 0) return true;
      const cutoff = new Date(today);
      cutoff.setMonth(cutoff.getMonth() + horizon);
      return !start || start <= cutoff;
    });
  }, [remoteProjects, allLinkedIds, horizon, today]);

  const filteredIds = useMemo(() => new Set(filteredRemote.map((p) => p.id)), [filteredRemote]);

  // Section 2/3 partition (linked handled separately via linkedPlannerProjects)
  const sections = useMemo(() => {
    const skipped = loadSkipped();
    const newP: RemoteProject[] = [];
    const skippedP: RemoteProject[] = [];
    for (const p of filteredRemote) {
      if (skipped.has(p.id)) skippedP.push(p);
      else newP.push(p);
    }
    return { new: newP, skipped: skippedP };
  }, [filteredRemote]);

  function patch(id: string, p: Partial<ProjectRowState>) {
    setRows((prev) => prev.map((r) => (r.productiveId === id ? { ...r, ...p } : r)));
  }

  // Only new/skipped (non-linked, non-hidden) rows can be selected for grouping
  const selectedRows = useMemo(
    () => rows.filter((r) => r.selected && !r.hidden && filteredIds.has(r.productiveId) && r.section !== "linked"),
    [rows, filteredIds]
  );

  function confirmGroup() {
    const name = groupInputValue.trim();
    if (!name || selectedRows.length < 2) return;
    const key = `g_${Date.now()}`;
    const primaryId = selectedRows[0].productiveId;
    const aliasIds = selectedRows.slice(1).map((r) => r.productiveId);
    const allIds = new Set(selectedRows.map((r) => r.productiveId));
    setRows((prev) => prev.map((r) => {
      if (!allIds.has(r.productiveId)) return r;
      if (r.productiveId === primaryId) {
        return { ...r, groupKey: key, isPrimary: true, hidden: false, selected: false, name, aliasIds };
      }
      return { ...r, groupKey: key, isPrimary: false, hidden: true, selected: false };
    }));
    setGroupInputValue("");
    setGroupInputVisible(false);
  }

  function ungroupKey(key: string) {
    setRows((prev) => prev.map((r) => {
      if (r.groupKey !== key) return r;
      return {
        ...r,
        groupKey: null,
        isPrimary: false,
        hidden: false,
        aliasIds: [],
        name: remoteProjects?.find((p) => p.id === r.productiveId)?.name ?? r.name,
      };
    }));
  }

  // Helper: union date range for a row (considering its aliasIds)
  function rowDateRange(row: ProjectRowState): { start: string | null; end: string | null } {
    const allIds = [row.productiveId, ...row.aliasIds];
    const allP = allIds.map((id) => remoteProjects?.find((p) => p.id === id)).filter(Boolean) as RemoteProject[];
    const starts = allP.map((p) => p.startDate).filter((d): d is string => d !== null).sort();
    const ends   = allP.map((p) => p.endDate).filter((d): d is string => d !== null).sort();
    return { start: starts[0] ?? null, end: ends[ends.length - 1] ?? null };
  }

  async function loadProjects() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync/projects");
      if (!res.ok) throw new Error(await res.text());
      const data: { remoteProjects: RemoteProject[]; existingProjects: ExistingProject[]; linkedPlannerProjects: LinkedPlannerProject[] } = await res.json();
      const skipped = loadSkipped();

      // Build the full set of already-linked productive IDs (primary + aliases)
      const allLinked = new Set<string>();
      for (const lp of data.linkedPlannerProjects) {
        allLinked.add(lp.productiveProjectId);
        for (const a of lp.aliasIds) allLinked.add(a);
      }

      setRemoteProjects(data.remoteProjects);
      setLinkedPlannerProjects(data.linkedPlannerProjects);

      const newRows: ProjectRowState[] = [
        // Section 1: one row per LinkedPlannerProject
        ...data.linkedPlannerProjects.map((lp) => ({
          productiveId: lp.productiveProjectId,
          included: true,
          selected: false,
          hidden: false,
          name: lp.name,
          section: "linked" as ProjectSection,
          groupKey: null,
          isPrimary: false,
          plannerProjectId: lp.id,
          aliasIds: lp.aliasIds,
        })),
        // Section 2 / 3: non-linked remote projects (aliases excluded)
        // Default to unchecked — user explicitly picks what to import
        ...data.remoteProjects
          .filter((p) => !allLinked.has(p.id))
          .map((p) => ({
            productiveId: p.id,
            included: false,
            selected: false,
            hidden: false,
            name: p.name,
            section: (skipped.has(p.id) ? "skipped" : "new") as ProjectSection,
            groupKey: null,
            isPrimary: false,
            plannerProjectId: null,
            aliasIds: [] as string[],
          })),
      ];
      setRows(newRows);
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function importProjects() {
    // Linked rows always included; new/skipped rows must pass time filter and not be hidden
    const toImport = rows.filter(
      (r) => r.included && !r.hidden &&
        (r.section === "linked" || filteredIds.has(r.productiveId)) &&
        (r.groupKey === null || r.isPrimary)
    );

    // Linked rows that were explicitly unchecked → delete from the planner
    const deleteIds = rows
      .filter((r) => r.section === "linked" && !r.included && r.plannerProjectId)
      .map((r) => r.plannerProjectId!);

    if (toImport.length === 0 && deleteIds.length === 0) {
      setMsg({ type: "error", text: "No projects selected." }); return;
    }
    if (deleteIds.length > 0 && !confirm(
      `This will permanently remove ${deleteIds.length} project${deleteIds.length !== 1 ? "s" : ""} and all their allocations from the planner. Continue?`
    )) return;

    // Persist skipped IDs for new/skipped rows that aren't being imported
    const importedPrimaryIds = new Set(toImport.filter(r => r.section !== "linked").map((r) => r.productiveId));
    const importedAllIds = new Set<string>();
    for (const r of toImport) {
      importedAllIds.add(r.productiveId);
      for (const a of r.aliasIds) importedAllIds.add(a);
    }
    const newlySkipped = rows.filter(
      (r) => filteredIds.has(r.productiveId) && r.section !== "linked" && !importedAllIds.has(r.productiveId)
    ).map((r) => r.productiveId);
    const prevSkipped = loadSkipped();
    const merged = new Set([...prevSkipped, ...newlySkipped]);
    for (const id of importedPrimaryIds) merged.delete(id);
    saveSkipped(merged);

    setImporting(true);
    setMsg(null);
    try {
      const payload = toImport.map((r) => {
        // Use union of dates across all grouped/aliased productive projects
        const { start: startDate, end: endDate } = rowDateRange(r);
        const primaryRemote = remoteProjects!.find((p) => p.id === r.productiveId);
        return {
          projectId: r.productiveId,
          aliasIds: r.aliasIds,
          name: r.name,
          clientName: primaryRemote?.clientName ?? null,
          startDate,
          endDate,
          plannerProjectId: r.plannerProjectId,
          importBookings,
        };
      });
      const res = await fetch("/api/sync/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: payload, deleteIds }),
      });
      const result = await res.json();
      const hasErrors = result.errors?.length > 0;
      const parts: string[] = [];
      if (result.created || result.updated) parts.push(`Created ${result.created}, updated ${result.updated}.`);
      if (result.deleted) parts.push(`Removed ${result.deleted} project(s).`);
      if (importBookings && result.allocationsWritten) parts.push(`Wrote ${result.allocationsWritten} allocation(s).`);
      let text = parts.join(" ") || "Done.";
      if (result.unmappedPersonIds?.length) {
        const names: string[] = result.unmappedPersonIds.map(
          (id: string) => result.unmappedPersonNames?.[id] ?? id
        );
        text += `\n⚠ ${result.unmappedPersonIds.length} person(s) in bookings not found in planner — their allocations were skipped:\n  ${names.join(", ")}\nRun People sync to import missing team members.`;
      }
      if (hasErrors) text += `\nErrors:\n${result.errors.join("\n")}`;
      setMsg({ type: hasErrors ? "error" : "ok", text });
      if (!hasErrors) setRemoteProjects(null);
      const listRes = await fetch("/api/sync");
      if (listRes.ok) onJobsRefresh(await listRes.json());
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setImporting(false);
    }
  }

  async function clearImported() {
    if (!confirm("Delete all projects imported from Productive? Their allocations will also be deleted.")) return;
    setClearing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync/projects", { method: "DELETE" });
      const { deleted } = await res.json();
      setMsg({ type: "ok", text: `Deleted ${deleted} imported project(s).` });
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setClearing(false);
    }
  }

  const totalIncluded = useMemo(
    () => rows.filter(
      (r) => r.included && !r.hidden &&
        (r.section === "linked" || filteredIds.has(r.productiveId)) &&
        (r.groupKey === null || r.isPrimary)
    ).length,
    [rows, filteredIds]
  );

  const totalToDelete = useMemo(
    () => rows.filter((r) => r.section === "linked" && !r.included && r.plannerProjectId).length,
    [rows]
  );

  // Render a header separator row
  function sectionHeader(label: string, count: number, headerClass: string) {
    return (
      <tr key={`hdr-${label}`}>
        <td colSpan={5} className={cn("px-3 py-2 text-xs font-semibold uppercase tracking-wide", headerClass)}>
          {label} ({count})
        </td>
      </tr>
    );
  }

  // Render a single project row (used for all sections)
  function renderRow(row: ProjectRowState, project: RemoteProject | null) {
    if (row.hidden) return null;
    const isLinked = row.section === "linked";
    const { start: unionStart, end: unionEnd } = rowDateRange(row);
    const groupCount = row.aliasIds.length; // how many are merged in

    return (
      <tr key={row.productiveId} className={cn(
        "hover:bg-gray-50 border-t border-gray-100",
        !row.included && "opacity-40",
        row.selected && "bg-violet-50"
      )}>
        {/* Select for grouping (new/skipped only) */}
        <td className="px-2 py-2 w-8">
          {!isLinked && (
            <input type="checkbox" checked={row.selected} disabled={!!row.groupKey}
              onChange={(e) => patch(row.productiveId, { selected: e.target.checked })}
              className="accent-violet-600" />
          )}
        </td>
        {/* Include in import */}
        <td className="px-2 py-2 w-8">
          <input type="checkbox" checked={row.included}
            onChange={(e) => patch(row.productiveId, { included: e.target.checked })} />
        </td>
        {/* Name */}
        <td className="px-3 py-2">
          <div className="flex items-center gap-2">
            {isLinked ? (
              <div className="space-y-1 w-full">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">{row.name}</span>
                  <span className="text-xs text-indigo-500 shrink-0 flex items-center gap-0.5">
                    <Link2 className="h-3 w-3" /> linked
                  </span>
                </div>
                {/* Alias chips + add-alias input */}
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-xs text-gray-400 font-mono">{row.productiveId}</span>
                  {row.aliasIds.map((aid) => (
                    <span key={aid} className="inline-flex items-center gap-0.5 rounded bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-xs font-mono text-indigo-700">
                      {aid}
                      <button
                        onClick={() => patch(row.productiveId, { aliasIds: row.aliasIds.filter((a) => a !== aid) })}
                        className="text-indigo-400 hover:text-red-500 ml-0.5"
                        title="Remove alias"
                      ><X className="h-2.5 w-2.5" /></button>
                    </span>
                  ))}
                  {aliasEditId === row.productiveId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const val = aliasInputValue.trim();
                        if (val && !row.aliasIds.includes(val) && val !== row.productiveId) {
                          patch(row.productiveId, { aliasIds: [...row.aliasIds, val] });
                        }
                        setAliasEditId(null);
                        setAliasInputValue("");
                      }}
                      className="flex items-center gap-1"
                    >
                      <input
                        autoFocus
                        type="text"
                        placeholder="Project ID…"
                        value={aliasInputValue}
                        onChange={(e) => setAliasInputValue(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") { setAliasEditId(null); setAliasInputValue(""); } }}
                        className="w-28 rounded border border-indigo-300 px-1.5 py-0.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      />
                      <button type="submit" className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Add</button>
                      <button type="button" onClick={() => { setAliasEditId(null); setAliasInputValue(""); }} className="text-gray-400 hover:text-gray-600"><X className="h-3 w-3" /></button>
                    </form>
                  ) : (
                    <button
                      onClick={() => { setAliasEditId(row.productiveId); setAliasInputValue(""); }}
                      className="text-xs text-gray-400 hover:text-indigo-600 font-medium"
                      title="Add a Productive project ID as alias"
                    >+ alias</button>
                  )}
                </div>
              </div>
            ) : (
              <>
                {groupCount > 0 && (
                  <span className={cn("shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium", groupColor(row.groupKey!))}>
                    +{groupCount} merged
                  </span>
                )}
                <input type="text" value={row.name} onChange={(e) => patch(row.productiveId, { name: e.target.value })}
                  disabled={!row.included}
                  className="w-full min-w-[160px] rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-gray-200 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300 disabled:text-gray-400" />
                {row.groupKey && (
                  <button onClick={() => ungroupKey(row.groupKey!)} title="Dissolve group"
                    className="shrink-0 text-gray-300 hover:text-red-400"><X className="h-3 w-3" /></button>
                )}
              </>
            )}
          </div>
        </td>
        {/* Client */}
        <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{project?.clientName ?? "—"}</td>
        {/* Dates (union for grouped/aliased rows) */}
        <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs tabular-nums">
          {fmtDate(unionStart)} → {fmtDate(unionEnd)}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={loadProjects} disabled={loading}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {loading ? "Loading…" : remoteProjects ? "Reload from Productive" : "Load from Productive"}
        </button>
        {remoteProjects && (
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <span>Show next</span>
            {([3, 6, 12, 0] as Horizon[]).map((h) => (
              <button key={h} onClick={() => setHorizon(h)}
                className={cn("rounded px-2 py-0.5 text-xs font-medium",
                  horizon === h ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100")}>
                {h === 0 ? "All" : `${h}mo`}
              </button>
            ))}
          </div>
        )}

        {/* Import bookings toggle */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={importBookings}
            onChange={(e) => setImportBookings(e.target.checked)}
            className="rounded"
          />
          Import resource bookings
        </label>

        <button onClick={clearImported} disabled={clearing}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50">
          {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Clear imported projects
        </button>
      </div>

      {/* Group action bar */}
      {selectedRows.length >= 2 && (
        <div className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-2">
          <Layers className="h-4 w-4 text-violet-600 shrink-0" />
          <span className="text-sm text-violet-700 font-medium">{selectedRows.length} projects selected</span>
          {groupInputVisible ? (
            <div className="flex items-center gap-2 ml-2">
              <input autoFocus type="text" placeholder="Group / project name…" value={groupInputValue}
                onChange={(e) => setGroupInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmGroup(); if (e.key === "Escape") setGroupInputVisible(false); }}
                className="rounded border border-violet-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-violet-400 w-56" />
              <button onClick={confirmGroup} className="rounded bg-violet-600 px-3 py-1 text-sm font-medium text-white hover:bg-violet-700">Group</button>
              <button onClick={() => setGroupInputVisible(false)} className="text-violet-400 hover:text-violet-600"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <button onClick={() => setGroupInputVisible(true)}
              className="ml-2 rounded-md bg-violet-600 px-3 py-1 text-sm font-medium text-white hover:bg-violet-700">
              Group as one project…
            </button>
          )}
          <button onClick={() => setRows((prev) => prev.map((r) => ({ ...r, selected: false })))} className="ml-auto text-violet-400 hover:text-violet-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Message */}
      {msg && (
        <div className={cn("rounded-md border p-3 text-sm whitespace-pre-wrap font-mono",
          msg.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700")}>
          {msg.text}
        </div>
      )}

      {/* Three-section table */}
      {remoteProjects && linkedPlannerProjects.length === 0 && filteredRemote.length === 0 && (
        <p className="text-sm text-gray-500">No active or upcoming projects match the selected window.</p>
      )}

      {remoteProjects && (linkedPlannerProjects.length > 0 || filteredRemote.length > 0) && (
        <>
          <div className="rounded-lg border border-gray-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="w-8 px-2 py-2" />
                  <th className="w-8 px-2 py-2" />
                  <th className="px-3 py-2 text-left">Project name</th>
                  <th className="px-3 py-2 text-left">Client</th>
                  <th className="px-3 py-2 text-left">Dates</th>
                </tr>
              </thead>
              <tbody>
                {/* Section 1: already linked */}
                {linkedPlannerProjects.length > 0 && sectionHeader("Already linked — update name & dates", linkedPlannerProjects.length, "bg-indigo-50 text-indigo-700")}
                {rows
                  .filter((r) => r.section === "linked")
                  .map((row) => renderRow(row, remoteProjects.find((p) => p.id === row.productiveId) ?? null))}

                {/* Section 2: new */}
                {sections.new.length > 0 && sectionHeader("New", rows.filter(r => r.section === "new" && !r.hidden && filteredIds.has(r.productiveId) && (r.groupKey === null || r.isPrimary)).length, "bg-green-50 text-green-700")}
                {rows
                  .filter((r) => r.section === "new" && !r.hidden && filteredIds.has(r.productiveId))
                  .map((row) => renderRow(row, remoteProjects.find((p) => p.id === row.productiveId) ?? null))}

                {/* Section 3: previously skipped */}
                {sections.skipped.length > 0 && (
                  <tr key="hdr-skipped">
                    <td colSpan={5} className="bg-gray-50 px-3 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Previously skipped ({rows.filter(r => r.section === "skipped" && !r.hidden && filteredIds.has(r.productiveId) && (r.groupKey === null || r.isPrimary)).length})
                        </span>
                        <button
                          onClick={() => {
                            const ids = rows.filter(r => r.section === "skipped" && filteredIds.has(r.productiveId)).map(r => r.productiveId);
                            const current = loadSkipped();
                            ids.forEach(id => current.delete(id));
                            saveSkipped(current);
                            setRows(prev => prev.map(r =>
                              r.section === "skipped" && filteredIds.has(r.productiveId)
                                ? { ...r, section: "new" as ProjectSection }
                                : r
                            ));
                          }}
                          className="text-xs text-blue-500 hover:underline"
                        >
                          Restore all to New
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                {rows
                  .filter((r) => r.section === "skipped" && !r.hidden && filteredIds.has(r.productiveId))
                  .map((row) => renderRow(row, remoteProjects.find((p) => p.id === row.productiveId) ?? null))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">
              {totalIncluded > 0 && `${totalIncluded} project${totalIncluded !== 1 ? "s" : ""} will be imported / updated`}
              {totalIncluded > 0 && totalToDelete > 0 && " · "}
              {totalToDelete > 0 && <span className="text-red-500">{totalToDelete} will be removed</span>}
              {totalIncluded === 0 && totalToDelete === 0 && "Nothing selected"}
            </span>
            <button onClick={importProjects} disabled={importing || (totalIncluded === 0 && totalToDelete === 0)}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {importing ? "Importing…" : `Import / update ${totalIncluded}${totalToDelete > 0 ? ` · remove ${totalToDelete}` : ""}`}
            </button>
          </div>
        </>
      )}

      {!remoteProjects && !loading && (
        <p className="text-sm text-gray-500">Click "Load from Productive" to preview active projects.</p>
      )}
    </div>
  );
}

// ── Time-off tab ─────────────────────────────────────────────────────

function TimeOffTab() {
  const [syncing, setSyncing] = useState(false);
  const [syncingHolidays, setSyncingHolidays] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [holidayMsg, setHolidayMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  async function syncTimeOff() {
    setSyncing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const s = data.stats;
      setMsg({
        type: s.errors?.length ? "error" : "ok",
        text: s.errors?.length
          ? s.errors.join("\n")
          : `Created ${s.timeOff.created} override(s), updated ${s.timeOff.updated}.`,
      });
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setSyncing(false);
    }
  }

  async function syncHolidays() {
    setSyncingHolidays(true);
    setHolidayMsg(null);
    try {
      const res = await fetch("/api/sync/holidays", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(data));
      const hasErrors = data.errors?.length > 0;
      setHolidayMsg({
        type: hasErrors ? "error" : "ok",
        text: hasErrors
          ? data.errors.join("\n")
          : `${data.calendarsFound} calendar(s) · ${data.holidaysUpserted} holiday(s) synced · ${data.peopleUpdated} person(s) assigned.`,
      });
    } catch (err) {
      setHolidayMsg({ type: "error", text: String(err) });
    } finally {
      setSyncingHolidays(false);
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Absence bookings */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Absence bookings</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Pulls PTO, sick leave, etc. from Productive and reduces capacity for affected weeks.
            Manual overrides are never touched.
          </p>
        </div>
        <button
          onClick={syncTimeOff}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncing ? "Syncing…" : "Sync absence bookings"}
        </button>
        {msg && (
          <div className={cn(
            "rounded-md border p-3 text-sm whitespace-pre-wrap font-mono",
            msg.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          )}>
            {msg.text}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100" />

      {/* Holidays */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">Public holidays</h3>
          <p className="mt-0.5 text-sm text-gray-500">
            Reads each employee's holiday calendar from their Productive cost rate and syncs
            public holidays for this year and next. Holidays reduce supply FTE proportionally
            (same as absence — 1 holiday = 1 non-working day in that week).
          </p>
        </div>
        <button
          onClick={syncHolidays}
          disabled={syncingHolidays}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {syncingHolidays ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {syncingHolidays ? "Syncing…" : "Sync public holidays"}
        </button>
        {holidayMsg && (
          <div className={cn(
            "rounded-md border p-3 text-sm whitespace-pre-wrap font-mono",
            holidayMsg.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
          )}>
            {holidayMsg.text}
          </div>
        )}
      </div>
    </div>
  );
}

// ── History tab ──────────────────────────────────────────────────────

function HistoryTab({ jobs }: { jobs: SyncJob[] }) {
  if (jobs.length === 0) return <p className="text-sm text-gray-500">No sync history yet.</p>;
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-4 py-2 text-left">Started</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Duration</th>
            <th className="px-4 py-2 text-left">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {jobs.map((job) => {
            const stats = job.stats ? JSON.parse(job.stats) : null;
            return (
              <tr key={job.id} className="hover:bg-gray-50 align-top">
                <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    {fmtDatetime(job.startedAt)}
                  </div>
                </td>
                <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                <td className="px-4 py-3 text-gray-500 tabular-nums">{duration(job.startedAt, job.finishedAt)}</td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  {stats?.timeOff && (
                    <span>Time-off: <span className="text-green-700 font-medium">+{stats.timeOff.created}</span>{" "}<span className="text-blue-700 font-medium">~{stats.timeOff.updated}</span></span>
                  )}
                  {stats?.errors?.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {stats.errors.map((e: string, i: number) => <li key={i} className="font-mono text-red-600 break-all">{e}</li>)}
                    </ul>
                  )}
                  {!stats && job.message && <span className="font-mono text-red-600 break-all">{job.message}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Root ─────────────────────────────────────────────────────────────

type Tab = "deals" | "projects" | "timeoff" | "history";

export function SyncClient({ jobs: initialJobs }: { jobs: SyncJob[] }) {
  const [tab, setTab] = useState<Tab>("deals");
  const [jobs, setJobs] = useState<SyncJob[]>(initialJobs);

  const tabs: { key: Tab; label: string }[] = [
    { key: "deals", label: "Import Deals" },
    { key: "projects", label: "Import Projects" },
    { key: "timeoff", label: "Time-off" },
    { key: "history", label: "History" },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Productive Sync</h1>
      <div className="flex gap-0 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px",
              tab === t.key ? "border-indigo-600 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "deals" && <DealsTab jobs={jobs} onJobsRefresh={setJobs} />}
      {tab === "projects" && <ProjectsTab jobs={jobs} onJobsRefresh={setJobs} />}
      {tab === "timeoff" && <TimeOffTab />}
      {tab === "history" && <HistoryTab jobs={jobs} />}
    </div>
  );
}
