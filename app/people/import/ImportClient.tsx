"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Users, CheckSquare, Square, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProductivePersonRow } from "@/app/api/productive/people/route";

// ── Types ────────────────────────────────────────────────────────

interface SeniorityOption {
  id: string;
  name: string;
  role: { name: string; team: { name: string } };
}

interface Props {
  allSeniorities: SeniorityOption[];
}

interface Assignment {
  seniorityId: string;
  selected: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────

function groupSeniorities(
  seniorities: SeniorityOption[]
): Record<string, Record<string, SeniorityOption[]>> {
  return seniorities.reduce<Record<string, Record<string, SeniorityOption[]>>>(
    (acc, s) => {
      const team = s.role.team.name;
      const role = s.role.name;
      ((acc[team] ??= {})[role] ??= []).push(s);
      return acc;
    },
    {}
  );
}

function SenioritySelect({
  value,
  onChange,
  grouped,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  grouped: Record<string, Record<string, SeniorityOption[]>>;
  placeholder?: string;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs"
    >
      <option value="">{placeholder ?? "— assign role —"}</option>
      {Object.entries(grouped).map(([team, roles]) => (
        <optgroup key={team} label={team}>
          {Object.entries(roles).map(([role, tiers]) =>
            tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {role} · {t.name}
              </option>
            ))
          )}
        </optgroup>
      ))}
    </Select>
  );
}

// ── Main component ───────────────────────────────────────────────

export function ImportClient({ allSeniorities }: Props) {
  const router = useRouter();
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">("idle");
  const [people, setPeople] = useState<ProductivePersonRow[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const grouped = groupSeniorities(allSeniorities);

  const fetchPeople = useCallback(async () => {
    setLoadState("loading");
    setFetchError(null);
    setImportResult(null);

    try {
      const res = await fetch("/api/productive/people");
      const data = await res.json();

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      const rows: ProductivePersonRow[] = data.people;
      setPeople(rows);

      // Initialise assignment map — pre-fill matches, select all unimported
      const map: Record<string, Assignment> = {};
      for (const p of rows) {
        map[p.productiveId] = {
          seniorityId: p.suggestedSeniorityId ?? "",
          selected: !p.alreadyImported,
        };
      }
      setAssignments(map);
      setLoadState("idle");
    } catch (e) {
      setFetchError(String(e));
      setLoadState("error");
    }
  }, []);

  // Auto-fetch on mount
  useEffect(() => { fetchPeople(); }, [fetchPeople]);

  const setSeniority = (productiveId: string, seniorityId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [productiveId]: { ...prev[productiveId], seniorityId },
    }));
  };

  const toggleSelected = (productiveId: string) => {
    setAssignments((prev) => ({
      ...prev,
      [productiveId]: {
        ...prev[productiveId],
        selected: !prev[productiveId]?.selected,
      },
    }));
  };

  const selectAll = (onlyNew = true) => {
    setAssignments((prev) => {
      const next = { ...prev };
      for (const p of people) {
        if (onlyNew && p.alreadyImported) continue;
        next[p.productiveId] = { ...next[p.productiveId], selected: true };
      }
      return next;
    });
  };

  const deselectAll = () => {
    setAssignments((prev) => {
      const next = { ...prev };
      for (const p of people) {
        next[p.productiveId] = { ...next[p.productiveId], selected: false };
      }
      return next;
    });
  };

  const toImport = people.filter(
    (p) =>
      !p.alreadyImported &&
      assignments[p.productiveId]?.selected &&
      assignments[p.productiveId]?.seniorityId
  );

  const unassigned = people.filter(
    (p) =>
      !p.alreadyImported &&
      assignments[p.productiveId]?.selected &&
      !assignments[p.productiveId]?.seniorityId
  );

  async function doImport() {
    setImporting(true);
    setImportResult(null);
    try {
      const payload = toImport.map((p) => ({
        productiveId: p.productiveId,
        fullName: p.fullName,
        email: p.email,
        seniorityId: assignments[p.productiveId].seniorityId,
      }));

      const res = await fetch("/api/productive/people/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ people: payload }),
      });
      const result = await res.json();
      setImportResult(result);

      // Refresh the list to mark newly-imported people
      await fetchPeople();
      router.refresh();
    } finally {
      setImporting(false);
    }
  }

  const newPeople = people.filter((p) => !p.alreadyImported);
  const alreadyImported = people.filter((p) => p.alreadyImported);
  const autoMatched = newPeople.filter((p) => p.suggestedSeniorityId).length;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Import people from Productive
          </h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Fetches all active users. Auto-matches job titles to seniority tiers
            — review and override before importing.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={fetchPeople}
          disabled={loadState === "loading"}
        >
          <RefreshCw size={14} className={cn(loadState === "loading" && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {loadState === "loading" && (
        <div className="flex items-center gap-2 py-12 justify-center text-sm text-gray-500">
          <Loader2 size={16} className="animate-spin" />
          Fetching from Productive…
        </div>
      )}

      {/* Error */}
      {loadState === "error" && fetchError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-500" />
            <div>
              <p className="font-medium text-red-800">Failed to connect to Productive</p>
              <p className="mt-1 font-mono text-xs text-red-700">{fetchError}</p>
              <p className="mt-2 text-sm text-red-600">
                Check that <code className="rounded bg-red-100 px-1">PRODUCTIVE_API_TOKEN</code> and{" "}
                <code className="rounded bg-red-100 px-1">PRODUCTIVE_ORG_ID</code> are set correctly in{" "}
                <code className="rounded bg-red-100 px-1">.env</code>, then restart the dev server.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div className={cn(
          "mb-4 rounded-xl border p-4",
          importResult.errors.length > 0
            ? "border-amber-200 bg-amber-50"
            : "border-green-200 bg-green-50"
        )}>
          <p className="font-medium text-gray-800">
            Import complete — {importResult.created} people added
            {importResult.skipped > 0 && `, ${importResult.skipped} skipped`}
          </p>
          {importResult.errors.map((e, i) => (
            <p key={i} className="mt-1 text-xs text-red-600">{e}</p>
          ))}
        </div>
      )}

      {/* Stats bar */}
      {loadState === "idle" && people.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm">
          <span className="flex items-center gap-1.5 text-gray-700">
            <Users size={14} />
            <strong>{people.length}</strong> in Productive
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-700">
            <strong>{newPeople.length}</strong> new to import
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-700">
            <strong>{autoMatched}</strong> auto-matched
          </span>
          {alreadyImported.length > 0 && (
            <>
              <span className="text-gray-400">·</span>
              <span className="text-gray-400">
                {alreadyImported.length} already imported
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => selectAll(true)}
              className="text-xs text-blue-600 hover:underline"
            >
              Select all new
            </button>
            <span className="text-gray-300">|</span>
            <button
              onClick={deselectAll}
              className="text-xs text-gray-500 hover:underline"
            >
              Deselect all
            </button>
          </div>
        </div>
      )}

      {/* People table */}
      {loadState === "idle" && people.length > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                  <th className="w-8 py-2 pl-4" />
                  <th className="py-2 text-left font-medium">Name</th>
                  <th className="py-2 text-left font-medium">Email</th>
                  <th className="py-2 text-left font-medium">Productive title</th>
                  <th className="py-2 pr-4 text-left font-medium">Assign to</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const assignment = assignments[person.productiveId];
                  const isSelected = assignment?.selected ?? false;
                  const hasMatch = !!person.suggestedSeniorityId;

                  return (
                    <tr
                      key={person.productiveId}
                      className={cn(
                        "border-b border-gray-100 last:border-0 transition-colors",
                        person.alreadyImported
                          ? "opacity-40"
                          : isSelected
                          ? "bg-blue-50/40"
                          : "hover:bg-gray-50"
                      )}
                    >
                      {/* Checkbox */}
                      <td className="py-2.5 pl-4">
                        {person.alreadyImported ? (
                          <span className="text-[10px] text-gray-400 font-medium">✓ done</span>
                        ) : (
                          <button
                            onClick={() => toggleSelected(person.productiveId)}
                            className="text-blue-500 hover:text-blue-700"
                            aria-label={isSelected ? "Deselect" : "Select"}
                          >
                            {isSelected ? (
                              <CheckSquare size={15} />
                            ) : (
                              <Square size={15} className="text-gray-400" />
                            )}
                          </button>
                        )}
                      </td>

                      {/* Name */}
                      <td className="py-2.5 font-medium text-gray-900">
                        {person.fullName}
                      </td>

                      {/* Email */}
                      <td className="py-2.5 text-gray-500 text-xs">
                        {person.email ?? "—"}
                      </td>

                      {/* Productive title */}
                      <td className="py-2.5">
                        {person.title ? (
                          <span className="flex items-center gap-1.5">
                            <span className="text-gray-700">{person.title}</span>
                            {hasMatch && !person.alreadyImported && (
                              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] text-green-700">
                                auto-matched
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>

                      {/* Assignment dropdown */}
                      <td className="py-2 pr-4">
                        {person.alreadyImported ? (
                          <span className="text-xs text-gray-400">Already imported</span>
                        ) : (
                          <SenioritySelect
                            value={assignment?.seniorityId ?? ""}
                            onChange={(v) => setSeniority(person.productiveId, v)}
                            grouped={grouped}
                            placeholder="— assign role —"
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Import footer */}
          <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
            <div className="text-sm text-gray-600">
              {toImport.length > 0 ? (
                <>
                  <strong>{toImport.length}</strong> people ready to import
                  {unassigned.length > 0 && (
                    <span className="ml-2 text-amber-600">
                      · {unassigned.length} selected but not yet assigned
                    </span>
                  )}
                </>
              ) : (
                <span className="text-gray-400">
                  Select people and assign each a role to import.
                </span>
              )}
            </div>
            <Button
              variant="primary"
              onClick={doImport}
              disabled={toImport.length === 0 || importing}
            >
              {importing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Importing…
                </>
              ) : (
                <>Import {toImport.length > 0 ? toImport.length : ""} people</>
              )}
            </Button>
          </div>
        </>
      )}

      {/* Empty state */}
      {loadState === "idle" && people.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
          No active users found in Productive.
        </div>
      )}
    </div>
  );
}
