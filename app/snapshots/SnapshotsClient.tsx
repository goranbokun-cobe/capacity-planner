"use client";

import { useState, useEffect } from "react";
import { Camera, Trash2, RotateCcw, GitCompare, Loader2, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SnapshotDiff } from "@/lib/snapshots";

// ── Types ────────────────────────────────────────────────────────────────────

interface SnapshotMeta {
  id: string;
  label: string;
  takenAt: string;
  notes: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function DiffBadge({ n, type }: { n: number; type: "add" | "remove" | "change" | "fte" }) {
  if (n === 0) return null;
  const cls =
    type === "add" ? "bg-green-100 text-green-700" :
    type === "remove" ? "bg-red-100 text-red-700" :
    type === "fte" ? "bg-blue-100 text-blue-700" :
    "bg-amber-100 text-amber-700";
  const sign = type === "add" ? "+" : type === "remove" ? "-" : "~";
  const label = type === "fte" ? `${n > 0 ? "+" : ""}${n} FTE` : `${sign}${n}`;
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-xs font-medium tabular-nums", cls)}>
      {label}
    </span>
  );
}

// ── Take-snapshot modal ───────────────────────────────────────────────────────

function TakeSnapshotModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (s: SnapshotMeta) => void;
}) {
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const snap: SnapshotMeta = await res.json();
      onCreated(snap);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Take snapshot</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Label <span className="text-red-500">*</span></label>
            <input
              autoFocus
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Pre Q3 planning"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="What changed since the last snapshot?"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-4 py-2 text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              type="submit"
              disabled={saving || !label.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {saving ? "Taking…" : "Take snapshot"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Diff panel ────────────────────────────────────────────────────────────────

function DiffPanel({ snapshotId, label, onClose }: { snapshotId: string; label: string; onClose: () => void }) {
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showProjects, setShowProjects] = useState(true);
  const [showPeople, setShowPeople] = useState(false);
  const [showAllocations, setShowAllocations] = useState(false);

  useEffect(() => {
    fetch(`/api/snapshots/${snapshotId}/diff`)
      .then((r) => r.json())
      .then((d) => { setDiff(d); setLoading(false); })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, [snapshotId]);

  function Section({
    title, open, onToggle, children, count,
  }: {
    title: string; open: boolean; onToggle: () => void;
    children: React.ReactNode; count: number;
  }) {
    return (
      <div className="border-t border-gray-100">
        <button
          onClick={onToggle}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <span>{title} <span className="ml-1 text-xs text-gray-400">({count})</span></span>
          {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
        </button>
        {open && <div className="px-4 pb-4">{children}</div>}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/20">
      <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Diff vs. current</h2>
            <p className="mt-0.5 text-xs text-gray-500 truncate max-w-[320px]">Snapshot: {label}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Computing diff…
            </div>
          )}
          {error && <p className="p-4 text-sm text-red-600">{error}</p>}
          {diff && (
            <>
              {/* Summary row */}
              <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
                <DiffBadge n={diff.summary.projectsAdded} type="add" />
                <DiffBadge n={diff.summary.projectsRemoved} type="remove" />
                <DiffBadge n={diff.summary.projectsChanged} type="change" />
                {diff.summary.fteChanged > 0 && (
                  <span className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">
                    {diff.summary.fteChanged} FTE moved
                  </span>
                )}
                <DiffBadge n={diff.summary.peopleAdded} type="add" />
                <DiffBadge n={diff.summary.peopleRemoved} type="remove" />
                {diff.summary.projectsAdded === 0 &&
                  diff.summary.projectsRemoved === 0 &&
                  diff.summary.projectsChanged === 0 &&
                  diff.summary.fteChanged === 0 &&
                  diff.summary.peopleAdded === 0 &&
                  diff.summary.peopleRemoved === 0 &&
                  diff.summary.peopleChanged === 0 && (
                    <span className="text-xs text-gray-500">No changes — snapshot matches current state.</span>
                  )}
              </div>

              {/* Projects */}
              <Section
                title="Projects"
                open={showProjects}
                onToggle={() => setShowProjects(!showProjects)}
                count={diff.summary.projectsAdded + diff.summary.projectsRemoved + diff.summary.projectsChanged}
              >
                {diff.projectsAdded.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 py-1 text-sm">
                    <span className="mt-0.5 shrink-0 rounded bg-green-100 px-1 text-[10px] font-semibold uppercase text-green-700">new</span>
                    <span className="text-gray-800">{p.name}</span>
                    <span className="ml-auto text-xs text-gray-400 shrink-0">{p.status}</span>
                  </div>
                ))}
                {diff.projectsRemoved.map((p) => (
                  <div key={p.id} className="flex items-start gap-2 py-1 text-sm">
                    <span className="mt-0.5 shrink-0 rounded bg-red-100 px-1 text-[10px] font-semibold uppercase text-red-700">del</span>
                    <span className="text-gray-500 line-through">{p.name}</span>
                  </div>
                ))}
                {diff.projectsChanged.map((p) => (
                  <div key={p.id} className="py-1 text-sm">
                    <div className="font-medium text-gray-800">{p.name}</div>
                    {p.changes.map((c, i) => (
                      <div key={i} className="ml-2 text-xs text-gray-500">{c}</div>
                    ))}
                  </div>
                ))}
                {diff.projectsAdded.length === 0 && diff.projectsRemoved.length === 0 && diff.projectsChanged.length === 0 && (
                  <p className="text-xs text-gray-400">No project changes.</p>
                )}
              </Section>

              {/* Allocations */}
              <Section
                title="Allocation changes"
                open={showAllocations}
                onToggle={() => setShowAllocations(!showAllocations)}
                count={diff.allocationDeltas.length}
              >
                {diff.allocationDeltas.length === 0 ? (
                  <p className="text-xs text-gray-400">No allocation changes.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 uppercase text-[10px]">
                        <th className="pb-1 text-left">Project</th>
                        <th className="pb-1 text-right">Δ FTE</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {diff.allocationDeltas.map((d) => (
                        <tr key={d.projectId}>
                          <td className="py-1 text-gray-700">{d.projectName}</td>
                          <td className={cn(
                            "py-1 text-right font-mono font-medium tabular-nums",
                            d.deltaFte > 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {d.deltaFte > 0 ? "+" : ""}{d.deltaFte}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Section>

              {/* People */}
              <Section
                title="People"
                open={showPeople}
                onToggle={() => setShowPeople(!showPeople)}
                count={diff.summary.peopleAdded + diff.summary.peopleRemoved + diff.summary.peopleChanged}
              >
                {diff.peopleAdded.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 py-1 text-sm">
                    <span className="shrink-0 rounded bg-green-100 px-1 text-[10px] font-semibold uppercase text-green-700">new</span>
                    <span>{p.fullName}</span>
                  </div>
                ))}
                {diff.peopleRemoved.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 py-1 text-sm">
                    <span className="shrink-0 rounded bg-red-100 px-1 text-[10px] font-semibold uppercase text-red-700">del</span>
                    <span className="text-gray-400 line-through">{p.fullName}</span>
                  </div>
                ))}
                {diff.peopleChanged.map((p) => (
                  <div key={p.id} className="py-1 text-sm">
                    <div className="font-medium text-gray-800">{p.fullName}</div>
                    {p.changes.map((c, i) => (
                      <div key={i} className="ml-2 text-xs text-gray-500">{c}</div>
                    ))}
                  </div>
                ))}
                {diff.summary.peopleAdded === 0 && diff.summary.peopleRemoved === 0 && diff.summary.peopleChanged === 0 && (
                  <p className="text-xs text-gray-400">No people changes.</p>
                )}
              </Section>

              {/* Settings */}
              {diff.settingsChanged.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Settings</p>
                  {diff.settingsChanged.map((c, i) => (
                    <p key={i} className="text-xs text-gray-600">{c}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export function SnapshotsClient({ initial }: { initial: SnapshotMeta[] }) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>(initial);
  const [showTake, setShowTake] = useState(false);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const diffSnapshot = snapshots.find((s) => s.id === diffId);

  async function doDelete(id: string) {
    if (!confirm("Delete this snapshot? This cannot be undone.")) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/snapshots/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      setSnapshots((prev) => prev.filter((s) => s.id !== id));
      setMsg({ type: "ok", text: "Snapshot deleted." });
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setDeleting(null);
    }
  }

  async function doRestore(id: string, label: string) {
    if (!confirm(
      `Restore "${label}"?\n\nThis will overwrite all current planner data. A pre-restore snapshot will be taken automatically first.`
    )) return;
    setRestoring(id);
    setMsg(null);
    try {
      const res = await fetch(`/api/snapshots/${id}/restore`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      // Refresh snapshot list (a pre-restore snapshot was added)
      const listRes = await fetch("/api/snapshots");
      if (listRes.ok) setSnapshots(await listRes.json());
      setMsg({
        type: "ok",
        text: `Restored "${data.restored}". Pre-restore snapshot saved as "${data.preRestoreLabel}". Reload the page to see changes.`,
      });
    } catch (err) {
      setMsg({ type: "error", text: String(err) });
    } finally {
      setRestoring(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Snapshots</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Save the full planner state, diff against current, or restore a past version.
          </p>
        </div>
        <button
          onClick={() => setShowTake(true)}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          <Plus className="h-4 w-4" />
          Take snapshot
        </button>
      </div>

      {/* Message */}
      {msg && (
        <div className={cn(
          "rounded-md border p-3 text-sm",
          msg.type === "ok" ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"
        )}>
          {msg.text}
        </div>
      )}

      {/* Snapshot list */}
      {snapshots.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-white py-16 text-center">
          <Camera className="mx-auto h-8 w-8 text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">No snapshots yet.</p>
          <p className="mt-1 text-xs text-gray-400">Take a snapshot before making big changes to the plan.</p>
          <button
            onClick={() => setShowTake(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Camera className="h-4 w-4" /> Take first snapshot
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2.5 text-left">Label</th>
                <th className="px-4 py-2.5 text-left">Taken</th>
                <th className="px-4 py-2.5 text-left">Notes</th>
                <th className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {snapshots.map((snap) => (
                <tr key={snap.id} className="hover:bg-gray-50 align-top">
                  <td className="px-4 py-3 font-medium text-gray-800">{snap.label}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap tabular-nums">{fmtDate(snap.takenAt)}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs max-w-[260px] truncate">{snap.notes ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setDiffId(snap.id)}
                        title="Diff vs. current"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                      >
                        <GitCompare className="h-3.5 w-3.5" /> Diff
                      </button>
                      <button
                        onClick={() => doRestore(snap.id, snap.label)}
                        disabled={restoring === snap.id}
                        title="Restore this snapshot"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-600 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {restoring === snap.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <RotateCcw className="h-3.5 w-3.5" />}
                        Restore
                      </button>
                      <button
                        onClick={() => doDelete(snap.id)}
                        disabled={deleting === snap.id}
                        title="Delete snapshot"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-50 disabled:opacity-50"
                      >
                        {deleting === snap.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals / panels */}
      {showTake && (
        <TakeSnapshotModal
          onClose={() => setShowTake(false)}
          onCreated={(s) => {
            setSnapshots((prev) => [s, ...prev]);
            setShowTake(false);
            setMsg({ type: "ok", text: `Snapshot "${s.label}" taken.` });
          }}
        />
      )}
      {diffId && diffSnapshot && (
        <DiffPanel
          snapshotId={diffId}
          label={diffSnapshot.label}
          onClose={() => setDiffId(null)}
        />
      )}
    </div>
  );
}
