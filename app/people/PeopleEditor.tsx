"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { Plus, Archive, Loader2, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { upcomingWeeks, weekLabel } from "@/lib/weeks";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────

interface Override {
  id: string;
  weekId: string;
  capacity: number;
  reason: string | null;
  source: string;
}

interface SeniorityTier {
  id: string;
  name: string;
  level: number;
  role: { id: string; name: string; team: { id: string; name: string } };
}

interface Person {
  id: string;
  fullName: string;
  email: string | null;
  baseCapacity: number;
  seniorityId: string;
  seniority: SeniorityTier;
  overrides: Override[];
}

interface Props {
  initialPeople: Person[];
  allSeniorities: SeniorityTier[];
}

// ── Capacity stepper ─────────────────────────────────────────────

function CapacityStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const step = 0.1;
  const dec = () => onChange(Math.max(0, Math.round((value - step) * 10) / 10));
  const inc = () => onChange(Math.min(1, Math.round((value + step) * 10) / 10));

  return (
    <div className="flex items-center gap-1">
      <button onClick={dec} className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100">−</button>
      <span className="w-8 text-center text-xs font-medium tabular-nums">{value.toFixed(1)}</span>
      <button onClick={inc} className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100">+</button>
    </div>
  );
}

// ── Override calendar strip ───────────────────────────────────────

function OverrideStrip({
  personId,
  baseCapacity,
  overrides,
  onChanged,
}: {
  personId: string;
  baseCapacity: number;
  overrides: Override[];
  onChanged: () => void;
}) {
  const weeks = upcomingWeeks(26);
  const overrideMap = Object.fromEntries(overrides.map((o) => [o.weekId, o]));
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ capacity: 0, reason: "" });

  async function saveOverride(weekId: string) {
    await fetch(`/api/people/${personId}/overrides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekId, capacity: draft.capacity, reason: draft.reason || null }),
    });
    setAdding(null);
    onChanged();
  }

  async function deleteOverride(weekId: string) {
    await fetch(`/api/people/${personId}/overrides/${weekId}`, { method: "DELETE" });
    onChanged();
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <div className="flex min-w-max gap-1 pb-1">
        {weeks.map((weekId) => {
          const override = overrideMap[weekId];
          const cap = override !== undefined ? override.capacity : baseCapacity;
          const hasOverride = override !== undefined;

          const bg =
            cap === 0
              ? "bg-red-100 border-red-300 text-red-700"
              : cap < 1
              ? "bg-amber-50 border-amber-300 text-amber-700"
              : "bg-green-50 border-green-200 text-green-700";

          return (
            <div key={weekId} className="relative">
              <button
                className={cn(
                  "flex flex-col items-center rounded border px-1.5 py-1 text-center transition-colors hover:opacity-80",
                  bg,
                  hasOverride && "ring-1 ring-offset-0 ring-blue-400"
                )}
                style={{ width: 44 }}
                onClick={() => {
                  if (hasOverride) {
                    if (confirm(`Remove override for ${weekId}?`)) deleteOverride(weekId);
                  } else {
                    setDraft({ capacity: 0, reason: "" });
                    setAdding(weekId);
                  }
                }}
                title={`${weekId}: ${cap.toFixed(1)} FTE${override?.reason ? ` (${override.reason})` : ""}`}
              >
                <span className="text-[10px] font-medium leading-none">
                  {weekId.slice(6)}
                </span>
                <span className="text-[11px] font-semibold leading-none mt-0.5 tabular-nums">
                  {cap.toFixed(1)}
                </span>
              </button>

              {adding === weekId && (
                <div className="absolute left-0 top-9 z-10 w-48 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
                  <p className="mb-2 text-xs font-medium text-gray-700">{weekId}</p>
                  <label className="block text-xs text-gray-500 mb-1">Capacity (FTE)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="1"
                    value={draft.capacity}
                    onChange={(e) => setDraft((d) => ({ ...d, capacity: parseFloat(e.target.value) }))}
                    className="mb-2 block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <label className="block text-xs text-gray-500 mb-1">Reason (optional)</label>
                  <input
                    type="text"
                    placeholder="PTO, Training…"
                    value={draft.reason}
                    onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
                    className="mb-3 block w-full rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <div className="flex gap-1">
                    <button
                      onClick={() => saveOverride(weekId)}
                      className="flex-1 rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700"
                    >Save</button>
                    <button
                      onClick={() => setAdding(null)}
                      className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >Cancel</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        Click a week to add/remove a capacity override. Blue ring = overridden.
      </p>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

type DialogMode = "addPerson" | null;

export function PeopleEditor({ initialPeople, allSeniorities }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());
  const [apiError, setApiError] = useState<string | null>(null);

  function toggleTeam(teamName: string) {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      next.has(teamName) ? next.delete(teamName) : next.add(teamName);
      return next;
    });
  }

  const refresh = () => startTransition(() => router.refresh());

  async function updateBaseCapacity(personId: string, baseCapacity: number) {
    setApiError(null);
    try {
      const res = await fetch(`/api/people/${personId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseCapacity }),
      });
      if (!res.ok) throw new Error("Failed");
      refresh();
    } catch (e) {
      setApiError(String(e));
    }
  }

  async function archivePerson(id: string) {
    if (!confirm("Archive this person?")) return;
    try {
      const res = await fetch(`/api/people/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      refresh();
    } catch (e) {
      setApiError(String(e));
    }
  }

  // Group by team for the table header
  const byTeam = initialPeople.reduce<Record<string, Person[]>>((acc, p) => {
    const team = p.seniority.role.team.name;
    (acc[team] ??= []).push(p);
    return acc;
  }, {});

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">People</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {initialPeople.length} team member{initialPeople.length !== 1 ? "s" : ""}.
            Click a row to expand the capacity override calendar.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/people/import"
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <Download size={14} />
            Import from Productive
          </a>
          <Button variant="primary" size="sm" onClick={() => setDialog("addPerson")}>
            <Plus size={14} />
            Add person
          </Button>
        </div>
      </div>

      {apiError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{apiError}</div>
      )}

      {initialPeople.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
          No people yet. Add your first team member.
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(byTeam).map(([teamName, people]) => {
            const isCollapsed = collapsedTeams.has(teamName);
            return (
            <div key={teamName}>
              <button
                onClick={() => toggleTeam(teamName)}
                className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {teamName}
                <span className="ml-0.5 normal-case font-normal">({people.length})</span>
              </button>
              {!isCollapsed && (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                      <th className="py-2 pl-4 text-left font-medium">Name</th>
                      <th className="py-2 text-left font-medium">Role</th>
                      <th className="py-2 text-left font-medium">Seniority</th>
                      <th className="py-2 text-center font-medium">Base FTE</th>
                      <th className="py-2 pr-4 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const isExpanded = expandedPerson === person.id;
                      const overrideCount = person.overrides.filter((o) => {
                        const now = new Date();
                        return o.weekId >= `${now.getFullYear()}-W01`;
                      }).length;

                      return (
                        <>
                          <tr
                            key={person.id}
                            className={cn(
                              "border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors",
                              isExpanded && "bg-blue-50/30"
                            )}
                            onClick={() =>
                              setExpandedPerson(isExpanded ? null : person.id)
                            }
                          >
                            <td className="py-2.5 pl-4">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown size={14} className="text-gray-400 shrink-0" />
                                ) : (
                                  <ChevronRight size={14} className="text-gray-400 shrink-0" />
                                )}
                                <span className="font-medium text-gray-900">{person.fullName}</span>
                                {person.email && (
                                  <span className="text-xs text-gray-400">{person.email}</span>
                                )}
                                {overrideCount > 0 && (
                                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
                                    {overrideCount} override{overrideCount !== 1 ? "s" : ""}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 text-gray-600">{person.seniority.role.name}</td>
                            <td className="py-2.5 text-gray-600">{person.seniority.name}</td>
                            <td
                              className="py-2.5 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <CapacityStepper
                                value={person.baseCapacity}
                                onChange={(v) => updateBaseCapacity(person.id, v)}
                              />
                            </td>
                            <td
                              className="py-2.5 pr-4 text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => archivePerson(person.id)}
                                className="rounded p-1 text-gray-400 hover:text-red-500"
                                title="Archive person"
                              >
                                <Archive size={14} />
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr key={`${person.id}-expand`} className="bg-blue-50/20">
                              <td colSpan={5} className="px-6 pb-3 pt-1">
                                <OverrideStrip
                                  personId={person.id}
                                  baseCapacity={person.baseCapacity}
                                  overrides={person.overrides}
                                  onChanged={refresh}
                                />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-lg text-sm text-gray-600">
          <Loader2 size={14} className="animate-spin" />
          Saving…
        </div>
      )}

      <AddPersonDialog
        open={dialog === "addPerson"}
        onClose={() => setDialog(null)}
        onSuccess={refresh}
        allSeniorities={allSeniorities}
      />
    </div>
  );
}

// ── Add person dialog ────────────────────────────────────────────

interface AddPersonForm {
  fullName: string;
  email: string;
  seniorityId: string;
  baseCapacity: string;
}

function AddPersonDialog({
  open,
  onClose,
  onSuccess,
  allSeniorities,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  allSeniorities: SeniorityTier[];
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } =
    useForm<AddPersonForm>({ defaultValues: { baseCapacity: "1.0" } });

  // Group seniorities by team > role
  const grouped = allSeniorities.reduce<Record<string, Record<string, SeniorityTier[]>>>(
    (acc, s) => {
      const team = s.role.team.name;
      const role = s.role.name;
      ((acc[team] ??= {})[role] ??= []).push(s);
      return acc;
    },
    {}
  );

  const submit = async (data: AddPersonForm) => {
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: data.fullName,
        email: data.email || null,
        seniorityId: data.seniorityId,
        baseCapacity: parseFloat(data.baseCapacity),
      }),
    });
    if (res.ok) { reset(); onClose(); onSuccess(); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add person" className="max-w-lg">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
          <Input {...register("fullName", { required: true })} placeholder="Ana Novak" autoFocus />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email (optional)</label>
          <Input {...register("email")} type="email" placeholder="ana@cobeisfresh.com" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role & seniority</label>
          <Select {...register("seniorityId", { required: true })} defaultValue="">
            <option value="" disabled>Select…</option>
            {Object.entries(grouped).map(([team, roles]) => (
              <optgroup key={team} label={team}>
                {Object.entries(roles).map(([role, tiers]) =>
                  tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {role} · {tier.name}
                    </option>
                  ))
                )}
              </optgroup>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Base capacity (FTE)</label>
          <Input
            {...register("baseCapacity", { required: true })}
            type="number"
            step="0.1"
            min="0"
            max="1"
          />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Adding…" : "Add person"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
