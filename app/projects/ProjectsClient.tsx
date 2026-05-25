"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { Plus, Archive, Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog } from "@/components/ui/dialog";
import { projectColor, hexToRgba, STATUS_LABELS, type ProjectStatus } from "@/lib/projects";
import { cn } from "@/lib/utils";
import { getCurrentWeekId, addWeeks } from "@/lib/weeks";

// ── Types ────────────────────────────────────────────────────────

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
  _count: { allocations: number };
}

interface ColorBand {
  minPct: number;
  maxPct: number;
  color: string;
  label: string;
}

interface Props {
  projects: Project[];
  colorBands?: ColorBand[];
}

type Tab = "all" | "pipeline" | "committed" | "running" | "done" | "internal";

const TABS: { key: Tab; label: string }[] = [
  { key: "all",       label: "All"       },
  { key: "pipeline",  label: "Pipeline"  },
  { key: "committed", label: "Committed" },
  { key: "running",   label: "Running"   },
  { key: "done",      label: "Done/Lost" },
  { key: "internal",  label: "Internal"  },
];

// ── Status badge ─────────────────────────────────────────────────

function StatusBadge({ status, probability, colorBands }: {
  status: string;
  probability: number | null;
  colorBands?: ColorBand[];
}) {
  const color = projectColor(status as ProjectStatus, probability, null, colorBands);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ background: hexToRgba(color, 0.15), color }}
    >
      {status === "pipeline" && probability != null ? `${probability}%` : ""}
      {status === "pipeline" && probability != null ? " · " : ""}
      {STATUS_LABELS[status as ProjectStatus] ?? status}
    </span>
  );
}

// ── Project row ──────────────────────────────────────────────────

function ProjectRow({ project, colorBands, onArchive }: {
  project: Project;
  colorBands?: ColorBand[];
  onArchive: (id: string) => void;
}) {
  const color = projectColor(
    project.status as ProjectStatus,
    project.probability,
    project.colorTagOverride,
    colorBands
  );
  const isDone = project.status === "done" || project.status === "lost";

  return (
    <div
      className={cn(
        "group flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md",
        isDone && "opacity-60"
      )}
    >
      {/* Color chip */}
      <div
        className="h-8 w-1.5 flex-shrink-0 rounded-full"
        style={{ background: color }}
      />

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/projects/${project.id}`}
          className={cn(
            "font-medium text-gray-900 hover:text-blue-600",
            isDone && "line-through"
          )}
        >
          {project.name}
        </Link>
        {project.clientName && (
          <span className="ml-2 text-sm text-gray-400">{project.clientName}</span>
        )}
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <StatusBadge
          status={project.status}
          probability={project.probability}
          colorBands={colorBands}
        />
        <span className="tabular-nums">
          {project.startWeekId} → {project.endWeekId}
        </span>
        {project._count.allocations > 0 && (
          <span className="text-gray-400">
            {project._count.allocations} alloc{project._count.allocations !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Link
          href={`/projects/${project.id}`}
          className="rounded p-1 text-gray-400 hover:text-blue-500"
          title="Edit project"
        >
          <ChevronRight size={16} />
        </Link>
        <button
          onClick={() => onArchive(project.id)}
          className="rounded p-1 text-gray-400 hover:text-red-500"
          title="Archive"
        >
          <Archive size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────

interface NewProjectForm {
  name: string;
  clientName: string;
  status: ProjectStatus;
  probability: string;
  startWeekId: string;
  endWeekId: string;
}

export function ProjectsClient({ projects, colorBands }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("all");
  const [showDialog, setShowDialog] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const refresh = () => startTransition(() => router.refresh());

  const currentWeek = getCurrentWeekId();

  const filtered = projects.filter((p) => {
    if (tab === "all") return true;
    if (tab === "done") return p.status === "done" || p.status === "lost";
    return p.status === tab;
  });

  const counts = {
    all: projects.length,
    pipeline: projects.filter((p) => p.status === "pipeline").length,
    committed: projects.filter((p) => p.status === "committed").length,
    running: projects.filter((p) => p.status === "running").length,
    done: projects.filter((p) => p.status === "done" || p.status === "lost").length,
    internal: projects.filter((p) => p.status === "internal").length,
  };

  async function archiveProject(id: string) {
    if (!confirm("Archive this project?")) return;
    setApiError(null);
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      refresh();
    } catch (e) { setApiError(String(e)); }
  }

  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } =
    useForm<NewProjectForm>({
      defaultValues: {
        status: "pipeline",
        probability: "50",
        startWeekId: currentWeek,
        endWeekId: addWeeks(currentWeek, 11),
      },
    });

  const watchedStatus = watch("status");

  async function createProject(data: NewProjectForm) {
    setApiError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        clientName: data.clientName || null,
        status: data.status,
        probability: data.status === "pipeline" ? parseInt(data.probability) : null,
        startWeekId: data.startWeekId,
        endWeekId: data.endWeekId,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setApiError(body?.error?.message ?? "Failed to create project");
      return;
    }
    const project = await res.json();
    reset();
    setShowDialog(false);
    refresh();
    router.push(`/projects/${project.id}`);
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <Button variant="primary" size="sm" onClick={() => setShowDialog(true)}>
          <Plus size={14} />
          New project
        </Button>
      </div>

      {apiError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{apiError}</div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1 w-fit">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === key
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {label}
            {counts[key] > 0 && (
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px]",
                tab === key ? "bg-gray-100 text-gray-600" : "bg-gray-200 text-gray-500"
              )}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Project list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center text-sm text-gray-400">
          {tab === "all" ? (
            <>No projects yet. Create your first project.</>
          ) : (
            <>No {tab} projects.</>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              colorBands={colorBands}
              onArchive={archiveProject}
            />
          ))}
        </div>
      )}

      {isPending && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-lg bg-white px-4 py-2 shadow-lg text-sm text-gray-600">
          <Loader2 size={14} className="animate-spin" /> Saving…
        </div>
      )}

      {/* New project dialog */}
      <Dialog open={showDialog} onClose={() => setShowDialog(false)} title="New project" className="max-w-lg">
        <form onSubmit={handleSubmit(createProject)} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Project name</label>
              <Input {...register("name", { required: true })} placeholder="Acme App Redesign" autoFocus />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Client (optional)</label>
              <Input {...register("clientName")} placeholder="Acme Corp" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <Select {...register("status")}>
                <option value="pipeline">Pipeline</option>
                <option value="committed">Committed</option>
                <option value="running">Running</option>
                <option value="internal">Internal</option>
              </Select>
            </div>
            {watchedStatus === "pipeline" && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Probability %</label>
                <Input
                  {...register("probability")}
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start week</label>
              <Input {...register("startWeekId", { required: true })} placeholder="2026-W24" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End week</label>
              <Input {...register("endWeekId", { required: true })} placeholder="2026-W36" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create & edit allocations"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
