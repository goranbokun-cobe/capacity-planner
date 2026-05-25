/**
 * Project color-coding helpers (§6.5).
 * These are pure functions — no DB calls.
 */

export type ProjectStatus = "pipeline" | "committed" | "running" | "done" | "lost" | "internal";
export type PipelineCalcMode = "weighted" | "full";

interface ColorBand {
  minPct: number;
  maxPct: number;
  color: string;
  label: string;
}

export const DEFAULT_COLOR_BANDS: ColorBand[] = [
  { minPct: 0,   maxPct: 24,  color: "#C7C7CC", label: "Long shot"  },
  { minPct: 25,  maxPct: 49,  color: "#A5C8FF", label: "Possible"   },
  { minPct: 50,  maxPct: 74,  color: "#FFD27F", label: "Likely"     },
  { minPct: 75,  maxPct: 99,  color: "#FF9F70", label: "Hot"        },
  { minPct: 100, maxPct: 100, color: "#34C759", label: "Won"        },
];

export const STATUS_COLORS: Record<ProjectStatus, string> = {
  pipeline:  "", // resolved via probability bands
  committed: "#34C759",
  running:   "#0A84FF",
  done:      "#8E8E93",
  lost:      "#8E8E93",
  internal:  "#8B5CF6",
};

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  pipeline:  "Pipeline",
  committed: "Committed",
  running:   "Running",
  done:      "Done",
  lost:      "Lost",
  internal:  "Internal",
};

/** Get the project's display color from its status and probability. */
export function projectColor(
  status: ProjectStatus,
  probability: number | null,
  colorTagOverride?: string | null,
  bands: ColorBand[] = DEFAULT_COLOR_BANDS
): string {
  if (colorTagOverride) return colorTagOverride;
  if (status === "pipeline") {
    const pct = probability ?? 0;
    const band = bands.find((b) => pct >= b.minPct && pct <= b.maxPct);
    return band?.color ?? "#C7C7CC";
  }
  return STATUS_COLORS[status];
}

/** Hex → rgba with given opacity, for background tints. */
export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
