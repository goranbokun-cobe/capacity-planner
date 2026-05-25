"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { ChevronDown, ChevronRight, Plus, Pencil, Archive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────

interface SeniorityTier {
  id: string;
  name: string;
  level: number;
  defaultCapacity: number;
}

interface Role {
  id: string;
  name: string;
  seniorities: SeniorityTier[];
}

interface Team {
  id: string;
  name: string;
  displayOrder: number;
  roles: Role[];
}

interface Props {
  initialTeams: Team[];
  personCountBySeniority: Record<string, number>;
}

// ── Inline-edit cell ─────────────────────────────────────────────

function EditableLabel({
  value,
  onSave,
  className,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <button
        className={cn("text-left hover:underline", className)}
        onClick={() => { setDraft(value); setEditing(true); }}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      className="rounded border border-blue-400 px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); if (draft.trim()) onSave(draft.trim()); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); setEditing(false); if (draft.trim()) onSave(draft.trim()); }
        if (e.key === "Escape") { setEditing(false); }
      }}
    />
  );
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
  const decrement = () => onChange(Math.max(0, Math.round((value - step) * 10) / 10));
  const increment = () => onChange(Math.min(1, Math.round((value + step) * 10) / 10));

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={decrement}
        className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100"
        aria-label="decrease"
      >
        −
      </button>
      <span className="w-8 text-center text-xs font-medium tabular-nums">
        {value.toFixed(1)}
      </span>
      <button
        onClick={increment}
        className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-500 hover:bg-gray-100"
        aria-label="increase"
      >
        +
      </button>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

type DialogMode =
  | { type: "addTeam" }
  | { type: "addRole"; teamId: string }
  | { type: "addSeniority"; roleId: string; nextLevel: number }
  | null;

export function TeamsEditor({ initialTeams, personCountBySeniority }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(
    () => new Set(initialTeams.map((t) => t.id))
  );
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(
    () => new Set(initialTeams.flatMap((t) => t.roles.map((r) => r.id)))
  );
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const toggleTeam = (id: string) =>
    setExpandedTeams((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleRole = (id: string) =>
    setExpandedRoles((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function apiCall(url: string, method: string, body?: unknown) {
    setApiError(null);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function renameTeam(id: string, name: string) {
    try { await apiCall(`/api/teams/${id}`, "PATCH", { name }); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function archiveTeam(id: string) {
    if (!confirm("Archive this team? It won't appear in new allocations.")) return;
    try { await apiCall(`/api/teams/${id}`, "DELETE"); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function renameRole(id: string, name: string) {
    try { await apiCall(`/api/roles/${id}`, "PATCH", { name }); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function archiveRole(id: string) {
    if (!confirm("Archive this role?")) return;
    try { await apiCall(`/api/roles/${id}`, "DELETE"); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function renameSeniority(id: string, name: string) {
    try { await apiCall(`/api/seniorities/${id}`, "PATCH", { name }); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function updateSeniorityCapacity(id: string, defaultCapacity: number) {
    try { await apiCall(`/api/seniorities/${id}`, "PATCH", { defaultCapacity }); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  async function archiveSeniority(id: string) {
    if (!confirm("Archive this seniority tier?")) return;
    try { await apiCall(`/api/seniorities/${id}`, "DELETE"); refresh(); }
    catch (e) { setApiError(String(e)); }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Teams</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Manage teams, roles, and seniority tiers.
            Click any name to rename inline.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={() => setDialog({ type: "addTeam" })}
        >
          <Plus size={14} />
          Add team
        </Button>
      </div>

      {apiError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          {apiError}
        </div>
      )}

      {/* Team list */}
      <div className="space-y-3">
        {initialTeams.map((team) => {
          const isExpanded = expandedTeams.has(team.id);
          const totalPeople = team.roles
            .flatMap((r) => r.seniorities)
            .reduce((sum, s) => sum + (personCountBySeniority[s.id] ?? 0), 0);

          return (
            <div
              key={team.id}
              className="rounded-xl border border-gray-200 bg-white shadow-sm"
            >
              {/* Team header */}
              <div className="flex items-center gap-2 px-4 py-3">
                <button
                  onClick={() => toggleTeam(team.id)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label={isExpanded ? "collapse" : "expand"}
                >
                  {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                <EditableLabel
                  value={team.name}
                  onSave={(name) => renameTeam(team.id, name)}
                  className="text-sm font-semibold text-gray-900"
                />
                <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                  {totalPeople} {totalPeople === 1 ? "person" : "people"}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ type: "addRole", teamId: team.id })}
                    title="Add role"
                  >
                    <Plus size={13} />
                    <span>Role</span>
                  </Button>
                  <button
                    onClick={() => archiveTeam(team.id)}
                    className="rounded p-1 text-gray-400 hover:text-red-500"
                    title="Archive team"
                  >
                    <Archive size={14} />
                  </button>
                </div>
              </div>

              {/* Roles */}
              {isExpanded && (
                <div className="border-t border-gray-100 px-4 pb-3 pt-2 space-y-2">
                  {team.roles.length === 0 && (
                    <p className="py-2 text-center text-xs text-gray-400">No roles yet</p>
                  )}
                  {team.roles.map((role) => {
                    const roleExpanded = expandedRoles.has(role.id);
                    const rolePeople = role.seniorities.reduce(
                      (sum, s) => sum + (personCountBySeniority[s.id] ?? 0),
                      0
                    );

                    return (
                      <div
                        key={role.id}
                        className="rounded-lg border border-gray-100 bg-gray-50"
                      >
                        {/* Role header */}
                        <div className="flex items-center gap-2 px-3 py-2">
                          <button
                            onClick={() => toggleRole(role.id)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            {roleExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <EditableLabel
                            value={role.name}
                            onSave={(name) => renameRole(role.id, name)}
                            className="text-sm font-medium text-gray-800"
                          />
                          <span className="text-xs text-gray-400">
                            {rolePeople}p · {role.seniorities.length} tier{role.seniorities.length !== 1 ? "s" : ""}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setDialog({
                                  type: "addSeniority",
                                  roleId: role.id,
                                  nextLevel: (role.seniorities.at(-1)?.level ?? 0) + 1,
                                })
                              }
                              title="Add seniority tier"
                            >
                              <Plus size={12} />
                              <span className="text-xs">Tier</span>
                            </Button>
                            <button
                              onClick={() => archiveRole(role.id)}
                              className="rounded p-1 text-gray-400 hover:text-red-500"
                              title="Archive role"
                            >
                              <Archive size={13} />
                            </button>
                          </div>
                        </div>

                        {/* Seniority tiers */}
                        {roleExpanded && role.seniorities.length > 0 && (
                          <div className="border-t border-gray-100 px-3 py-2">
                            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-1.5">
                              <span className="text-xs font-medium text-gray-400">Tier</span>
                              <span className="text-xs font-medium text-gray-400">Default FTE</span>
                              <span className="text-xs font-medium text-gray-400">People</span>
                              <span />
                              {role.seniorities.map((tier) => (
                                <>
                                  <EditableLabel
                                    key={`name-${tier.id}`}
                                    value={tier.name}
                                    onSave={(name) => renameSeniority(tier.id, name)}
                                    className="text-sm text-gray-700"
                                  />
                                  <CapacityStepper
                                    key={`cap-${tier.id}`}
                                    value={tier.defaultCapacity}
                                    onChange={(v) => updateSeniorityCapacity(tier.id, v)}
                                  />
                                  <span
                                    key={`count-${tier.id}`}
                                    className="text-center text-xs text-gray-500"
                                  >
                                    {personCountBySeniority[tier.id] ?? 0}
                                  </span>
                                  <button
                                    key={`arch-${tier.id}`}
                                    onClick={() => archiveSeniority(tier.id)}
                                    className="rounded p-0.5 text-gray-300 hover:text-red-400"
                                    title="Archive tier"
                                  >
                                    <Archive size={12} />
                                  </button>
                                </>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-lg text-sm text-gray-600">
          <Loader2 size={14} className="animate-spin" />
          Saving…
        </div>
      )}

      {/* Dialogs */}
      <AddTeamDialog
        open={dialog?.type === "addTeam"}
        onClose={() => setDialog(null)}
        onSuccess={refresh}
      />
      {dialog?.type === "addRole" && (
        <AddRoleDialog
          open
          teamId={dialog.teamId}
          onClose={() => setDialog(null)}
          onSuccess={refresh}
        />
      )}
      {dialog?.type === "addSeniority" && (
        <AddSeniorityDialog
          open
          roleId={dialog.roleId}
          nextLevel={dialog.nextLevel}
          onClose={() => setDialog(null)}
          onSuccess={refresh}
        />
      )}
    </div>
  );
}

// ── Add team dialog ──────────────────────────────────────────────

function AddTeamDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{ name: string }>();

  const submit = async (data: { name: string }) => {
    const res = await fetch("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) { reset(); onClose(); onSuccess(); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add team">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Team name</label>
          <Input {...register("name", { required: true })} placeholder="e.g. Mobile" autoFocus />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create team"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Add role dialog ──────────────────────────────────────────────

function AddRoleDialog({
  open,
  teamId,
  onClose,
  onSuccess,
}: {
  open: boolean;
  teamId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{ name: string }>();

  const submit = async (data: { name: string }) => {
    const res = await fetch("/api/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, teamId }),
    });
    if (res.ok) { reset(); onClose(); onSuccess(); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add role">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Role name</label>
          <Input {...register("name", { required: true })} placeholder="e.g. iOS Engineer" autoFocus />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create role"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Add seniority tier dialog ────────────────────────────────────

function AddSeniorityDialog({
  open,
  roleId,
  nextLevel,
  onClose,
  onSuccess,
}: {
  open: boolean;
  roleId: string;
  nextLevel: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<{
    name: string;
    defaultCapacity: string;
  }>({ defaultValues: { defaultCapacity: "1.0" } });

  const submit = async (data: { name: string; defaultCapacity: string }) => {
    const res = await fetch("/api/seniorities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleId,
        name: data.name,
        level: nextLevel,
        defaultCapacity: parseFloat(data.defaultCapacity),
      }),
    });
    if (res.ok) { reset(); onClose(); onSuccess(); }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Add seniority tier">
      <form onSubmit={handleSubmit(submit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tier name</label>
          <Input
            {...register("name", { required: true })}
            placeholder="e.g. Senior"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Default capacity (FTE)</label>
          <Input
            {...register("defaultCapacity", { required: true, min: 0, max: 1 })}
            type="number"
            step="0.1"
            min="0"
            max="1"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create tier"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
