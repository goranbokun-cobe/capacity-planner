"use client";

import { useState, useTransition, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Copy, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { projectColor, hexToRgba, STATUS_LABELS, type ProjectStatus } from "@/lib/projects";
import { getWeeksInRange, weekLabel } from "@/lib/weeks";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────

interface SeniorityTier {
  id: string;
  name: string;
  level: number;
  role: { name: string; team: { name: string; displayOrder: number } };
}

interface Allocation {
  id: string;
  weekId: string;
  seniorityId: string;
  fte: number;
}

interface Project {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  probability: number | null;
  pipelineCalcMode: string | null;
  startWeekId: string;
  endWeekId: string;
  colorTagOverride: string | null;
  notes: string | null;
  allocations: Allocation[];
}

interface ColorBand {
  minPct: number;
  maxPct: number;
  color: string;
  label: string;
}

interface Props {
  project: Project;
  allSeniorities: SeniorityTier[];
  colorBands?: ColorBand[];
  defaultCalcMode: "weighted" | "full";
}

// ── FTE stepper cell ─────────────────────────────────────────────

function FteCell({
  value,
  onChange,
  highlight,
}: {
  value: number;
  onChange: (v: number) => void;
  highlight: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const step = 0.1;
  const dec = () => onChange(Math.max(0, Math.round((value - step) * 10) / 10));
  const inc = () => onChange(Math.min(20, Math.round((value + step) * 10) / 10));

  function startEdit() {
    setDraft(value > 0 ? value.toFixed(1) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) {
      onChange(Math.min(20, Math.max(0, Math.round(parsed * 10) / 10)));
    }
    setEditing(false);
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center gap-0.5 px-1 py-1 rounded transition-colors",
        highlight && value > 0 && "bg-blue-50",
        value === 0 ? "opacity-40 hover:opacity-100" : ""
      )}
    >
      <button
        onClick={inc}
        className="flex h-4 w-full items-center justify-center rounded text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        ▲
      </button>
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          min="0"
          max="20"
          step="0.1"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(false); }}
          className="w-10 rounded border border-blue-400 bg-white text-center text-xs font-medium tabular-nums outline-none focus:ring-1 focus:ring-blue-400"
          autoFocus
        />
      ) : (
        <span
          onClick={startEdit}
          className="min-w-[2.2rem] cursor-text text-center text-xs font-medium tabular-nums hover:text-blue-600"
          title="Click to type a value"
        >
          {value > 0 ? value.toFixed(1) : "—"}
        </span>
      )}
      <button
        onClick={dec}
        className="flex h-4 w-full items-center justify-center rounded text-[10px] text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        disabled={value === 0}
      >
        ▼
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

export function ProjectEditor({
  project,
  allSeniorities,
  colorBands,
  defaultCalcMode,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Local editable state for project header fields
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName ?? "");
  const [status, setStatus] = useState(project.status);
  const [probability, setProbability] = useState(project.probability ?? 50);
  const [calcMode, setCalcMode] = useState<"weighted" | "full" | "default">(
    (project.pipelineCalcMode as "weighted" | "full") ?? "default"
  );
  const [startWeekId, setStartWeekId] = useState(project.startWeekId);
  const [endWeekId, setEndWeekId] = useState(project.endWeekId);
  const [notes, setNotes] = useState(project.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [headerDirty, setHeaderDirty] = useState(false);

  // Allocation map: key = `${weekId}:${seniorityId}`
  const [allocMap, setAllocMap] = useState<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const a of project.allocations) {
      m[`${a.weekId}:${a.seniorityId}`] = a.fte;
    }
    return m;
  });

  // Year filter: default to current year (clamped to project range)
  const currentYear = new Date().getFullYear();
  const projectStartYear = parseInt(startWeekId.slice(0, 4), 10);
  const projectEndYear   = parseInt(endWeekId.slice(0, 4), 10);
  const [viewYear, setViewYear] = useState<number>(() =>
    Math.max(projectStartYear, Math.min(projectEndYear, currentYear))
  );

  // All weeks in the selected year that fall within the project's date range
  const weeks = useMemo(() => {
    const yearFirst = `${viewYear}-W01`;
    const yearLast  = `${viewYear}-W53`;
    const from = startWeekId > yearFirst ? startWeekId : yearFirst;
    const to   = endWeekId   < yearLast  ? endWeekId   : yearLast;
    if (from > to) return [];
    return getWeeksInRange(from, to);
  }, [viewYear, startWeekId, endWeekId]);

  // Group seniorities by team (sorted by displayOrder)
  const byTeam = allSeniorities.reduce<Record<string, SeniorityTier[]>>(
    (acc, s) => { (acc[s.role.team.name] ??= []).push(s); return acc; },
    {}
  );
  const teamOrder = [...new Set(allSeniorities.map((s) => s.role.team.name))];

  const color = projectColor(
    status as ProjectStatus,
    status === "pipeline" ? probability : null,
    project.colorTagOverride,
    colorBands
  );

  const effectiveCalcMode = calcMode === "default" ? defaultCalcMode : calcMode;

  // ── Allocation save (debounce-free: save on each stepper tap) ──

  const saveAllocation = useCallback(
    async (weekId: string, seniorityId: string, fte: number) => {
      await fetch(`/api/projects/${project.id}/allocations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekId, seniorityId, fte }),
      });
    },
    [project.id]
  );

  function setFte(weekId: string, seniorityId: string, fte: number) {
    const key = `${weekId}:${seniorityId}`;
    setAllocMap((prev) => ({ ...prev, [key]: fte }));
    saveAllocation(weekId, seniorityId, fte);
  }

  // ── Copy week → fills all subsequent weeks with same column ───

  function copyWeekForward(fromWeekId: string) {
    const fromIdx = weeks.indexOf(fromWeekId);
    if (fromIdx < 0) return;

    const toWeekId = weeks[fromIdx + 1];
    if (!toWeekId) return;

    const updates: Array<[string, string, number]> = [];
    for (const sid of allSeniorities.map((s) => s.id)) {
      const srcFte = allocMap[`${fromWeekId}:${sid}`] ?? 0;
      updates.push([toWeekId, sid, srcFte]);
    }

    const newMap = { ...allocMap };
    for (const [wid, sid, fte] of updates) {
      newMap[`${wid}:${sid}`] = fte;
    }
    setAllocMap(newMap);

    for (const [wid, sid, fte] of updates) {
      saveAllocation(wid, sid, fte);
    }
  }

  // ── Linear ramp ────────────────────────────────────────────────

  const [rampDialog, setRampDialog] = useState(false);
  const [rampState, setRampState] = useState({
    seniorityId: allSeniorities[0]?.id ?? "",
    fromFte: "0.5",
    toFte: "1.0",
  });

  function applyRamp() {
    const n = weeks.length;
    if (n === 0) return;
    const from = parseFloat(rampState.fromFte);
    const to = parseFloat(rampState.toFte);
    const sid = rampState.seniorityId;

    const updates: Array<[string, string, number]> = [];
    for (let i = 0; i < n; i++) {
      const fte = Math.round((from + (to - from) * (i / Math.max(n - 1, 1))) * 10) / 10;
      updates.push([weeks[i], sid, fte]);
    }

    const newMap = { ...allocMap };
    for (const [wid, sid2, fte] of updates) {
      newMap[`${wid}:${sid2}`] = fte;
    }
    setAllocMap(newMap);
    for (const [wid, sid2, fte] of updates) {
      saveAllocation(wid, sid2, fte);
    }
    setRampDialog(false);
  }

  // ── Save header ────────────────────────────────────────────────

  async function saveHeader() {
    setSaving(true);
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        clientName: clientName || null,
        status,
        probability: status === "pipeline" ? probability : null,
        pipelineCalcMode: calcMode === "default" ? null : calcMode,
        startWeekId,
        endWeekId,
        notes: notes || null,
      }),
    });
    setSaving(false);
    setHeaderDirty(false);
    startTransition(() => router.refresh());
  }

  const mark = () => setHeaderDirty(true);

  return (
    <div>
      {/* Back + title */}
      <div className="mb-4 flex items-center gap-3">
        <Link href="/projects" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft size={16} />
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">{project.name}</h1>
        <div
          className="h-3 w-3 rounded-full flex-shrink-0"
          style={{ background: color }}
          title={`Color: ${color}`}
        />
      </div>

      {/* Header fields */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {/* Name */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
            <Input
              value={name}
              onChange={(e) => { setName(e.target.value); mark(); }}
            />
          </div>
          {/* Client */}
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
            <Input
              value={clientName}
              placeholder="Client name"
              onChange={(e) => { setClientName(e.target.value); mark(); }}
            />
          </div>
          {/* Status */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <Select value={status} onChange={(e) => { setStatus(e.target.value); mark(); }}>
              {(["pipeline", "committed", "running", "internal", "done", "lost"] as ProjectStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </Select>
          </div>
          {/* Probability */}
          {status === "pipeline" && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Probability: <span className="font-semibold text-gray-700">{probability}%</span>
              </label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={probability}
                onChange={(e) => { setProbability(parseInt(e.target.value)); mark(); }}
                className="w-full accent-blue-600"
              />
            </div>
          )}
          {/* Pipeline calc mode */}
          {(status === "pipeline") && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Demand calc</label>
              <Select
                value={calcMode}
                onChange={(e) => { setCalcMode(e.target.value as "weighted" | "full" | "default"); mark(); }}
              >
                <option value="default">Default ({defaultCalcMode})</option>
                <option value="weighted">Weighted × prob%</option>
                <option value="full">Full 100%</option>
              </Select>
            </div>
          )}
          {/* Start / End week */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Start week</label>
            <Input
              value={startWeekId}
              onChange={(e) => { setStartWeekId(e.target.value); mark(); }}
              placeholder="2026-W24"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">End week</label>
            <Input
              value={endWeekId}
              onChange={(e) => { setEndWeekId(e.target.value); mark(); }}
              placeholder="2026-W36"
            />
          </div>
        </div>

        {/* Notes */}
        <div className="mt-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); mark(); }}
            rows={2}
            placeholder="Any notes about this project…"
            className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Save bar */}
        {headerDirty && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setHeaderDirty(false); }}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={saveHeader}
              disabled={saving}
            >
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : "Save changes"}
            </Button>
          </div>
        )}
      </div>

      {/* Allocation grid */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Allocations</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {weeks.length} weeks · {allSeniorities.length} seniority tiers
              {status === "pipeline" && (
                <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                  {effectiveCalcMode === "weighted"
                    ? `weighted demand = FTE × ${probability}%`
                    : "demand counted at 100%"}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Year navigation */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1 py-0.5">
              <button
                onClick={() => setViewYear((y) => Math.max(projectStartYear, y - 1))}
                disabled={viewYear <= projectStartYear}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ‹
              </button>
              <span className="min-w-[3rem] text-center text-xs font-semibold text-gray-700">{viewYear}</span>
              <button
                onClick={() => setViewYear((y) => Math.min(projectEndYear, y + 1))}
                disabled={viewYear >= projectEndYear}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                ›
              </button>
            </div>
            {viewYear !== currentYear && projectStartYear <= currentYear && currentYear <= projectEndYear && (
              <button
                onClick={() => setViewYear(currentYear)}
                className="rounded border border-gray-200 bg-white px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                Today
              </button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRampDialog(true)}
              title="Linear ramp helper"
            >
              <TrendingUp size={13} />
              Ramp
            </Button>
          </div>
        </div>

        {weeks.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-400">
            Set valid start and end weeks above to see the allocation grid.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse text-xs">
              <thead>
                {/* Week headers */}
                <tr className="border-b border-gray-200">
                  <th className="sticky left-0 z-10 min-w-[180px] bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 border-r border-gray-200">
                    Team / Role / Seniority
                  </th>
                  {weeks.map((wid) => (
                    <th
                      key={wid}
                      className="min-w-[60px] border-l border-gray-100 bg-gray-50 px-1 py-1 text-center font-medium text-gray-500"
                    >
                      <div className="text-[10px]">{wid.slice(0, 4)}</div>
                      <div className="text-[10px] font-normal text-gray-400">{wid.slice(5)}</div>
                      <button
                        onClick={() => copyWeekForward(wid)}
                        title={`Copy ${wid} →`}
                        className="mt-0.5 w-full rounded text-[9px] text-gray-300 hover:text-blue-400 hover:bg-blue-50"
                      >
                        copy→
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamOrder.map((teamName) => {
                  const tiers = byTeam[teamName];
                  return tiers.map((tier, idx) => {
                    const isFirstInTeam = idx === 0;
                    const teamRowCount = tiers.length;

                    return (
                      <tr
                        key={tier.id}
                        className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors"
                      >
                        {/* Label */}
                        <td className="sticky left-0 z-10 bg-white border-r border-gray-100 px-3 py-1 min-w-[180px]">
                          {isFirstInTeam && (
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-0.5">
                              {teamName}
                            </div>
                          )}
                          <div className="text-xs text-gray-700">
                            <span className="text-gray-500">{tier.role.name}</span>
                            {" · "}
                            <span className="font-medium">{tier.name}</span>
                          </div>
                        </td>
                        {/* FTE cells */}
                        {weeks.map((wid) => {
                          const fte = allocMap[`${wid}:${tier.id}`] ?? 0;
                          return (
                            <td
                              key={wid}
                              className="border-l border-gray-100 p-0"
                              style={fte > 0 ? { background: hexToRgba(color, 0.08) } : undefined}
                            >
                              <FteCell
                                value={fte}
                                onChange={(v) => setFte(wid, tier.id, v)}
                                highlight={fte > 0}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  });
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ramp dialog */}
      {rampDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setRampDialog(false); }}
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h3 className="mb-4 text-base font-semibold text-gray-900">Linear ramp</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Seniority tier</label>
                <Select
                  value={rampState.seniorityId}
                  onChange={(e) => setRampState((s) => ({ ...s, seniorityId: e.target.value }))}
                >
                  {teamOrder.map((team) =>
                    (byTeam[team] ?? []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {team} · {t.role.name} · {t.name}
                      </option>
                    ))
                  )}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start FTE ({weeks[0]})</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={rampState.fromFte}
                    onChange={(e) => setRampState((s) => ({ ...s, fromFte: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End FTE ({weeks.at(-1)})</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={rampState.toFte}
                    onChange={(e) => setRampState((s) => ({ ...s, toFte: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRampDialog(false)}>Cancel</Button>
              <Button variant="primary" onClick={applyRamp}>Apply ramp</Button>
            </div>
          </div>
        </div>
      )}

      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-lg text-sm text-gray-600">
          <Loader2 size={14} className="animate-spin" /> Saving…
        </div>
      )}
    </div>
  );
}
