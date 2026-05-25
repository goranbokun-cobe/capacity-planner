"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { hexToRgba } from "@/lib/projects";
import { Loader2, Check } from "lucide-react";

interface ColorBand {
  minPct: number;
  maxPct: number;
  color: string;
  label: string;
}

interface Props {
  defaultCalcMode: "weighted" | "full";
  colorBands: ColorBand[];
}

export function SettingsClient({ defaultCalcMode, colorBands }: Props) {
  const router = useRouter();
  const [calcMode, setCalcMode] = useState(defaultCalcMode);
  const [bands, setBands] = useState<ColorBand[]>(colorBands);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const updateBandColor = (idx: number, color: string) => {
    setBands((prev) => prev.map((b, i) => i === idx ? { ...b, color } : b));
    setDirty(true);
  };

  const updateBandLabel = (idx: number, label: string) => {
    setBands((prev) => prev.map((b, i) => i === idx ? { ...b, label } : b));
    setDirty(true);
  };

  async function save() {
    setSaving(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defaultCalcMode: calcMode,
        colorBands: JSON.stringify(bands),
      }),
    });
    setSaving(false);
    setSaved(true);
    setDirty(false);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-xl font-semibold text-gray-900 mb-6">Settings</h1>

      <div className="space-y-6">
        {/* Pipeline calc mode */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-800">Pipeline demand calculation</h2>
          <p className="mb-3 text-xs text-gray-500">
            How pipeline deals contribute to demand by default. Can be overridden per project.
          </p>
          <Select
            value={calcMode}
            onChange={(e) => { setCalcMode(e.target.value as "weighted" | "full"); setDirty(true); }}
            className="w-64"
          >
            <option value="weighted">Weighted — FTE × probability %</option>
            <option value="full">Full 100% — count all pipeline at face value</option>
          </Select>
        </section>

        {/* Color bands */}
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-sm font-semibold text-gray-800">Pipeline probability colors</h2>
          <p className="mb-3 text-xs text-gray-500">
            Color chips shown on pipeline projects based on probability range.
          </p>
          <div className="space-y-2">
            {bands.map((band, idx) => (
              <div key={idx} className="flex items-center gap-3">
                {/* Preview */}
                <div
                  className="h-6 w-6 rounded-full border border-gray-200 flex-shrink-0"
                  style={{ background: band.color }}
                />
                {/* Range label */}
                <span className="w-16 text-xs text-gray-500 tabular-nums">
                  {band.minPct}–{band.maxPct}%
                </span>
                {/* Color chip preview */}
                <span
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: hexToRgba(band.color, 0.15), color: band.color }}
                >
                  {band.label}
                </span>
                {/* Color picker */}
                <div className="flex items-center gap-1.5">
                  <input
                    type="color"
                    value={band.color}
                    onChange={(e) => updateBandColor(idx, e.target.value)}
                    className="h-7 w-10 cursor-pointer rounded border border-gray-300 p-0.5"
                    title="Pick color"
                  />
                  <Input
                    value={band.color}
                    onChange={(e) => updateBandColor(idx, e.target.value)}
                    className="w-24 font-mono text-xs"
                  />
                </div>
                {/* Label */}
                <Input
                  value={band.label}
                  onChange={(e) => updateBandLabel(idx, e.target.value)}
                  className="w-28 text-xs"
                  placeholder="Label"
                />
              </div>
            ))}
          </div>
        </section>

        {/* Utilization thresholds (read-only note for now) */}
        <section className="rounded-xl border border-gray-100 bg-gray-50 p-5">
          <h2 className="mb-1 text-sm font-semibold text-gray-600">Utilization heatmap thresholds</h2>
          <p className="text-xs text-gray-500">
            Heatmap coloring is fixed in Phase 2. Editable thresholds arrive with the overview grid in Phase 3.
          </p>
          <div className="mt-3 flex gap-2 text-xs">
            {[
              { label: "≤69% green", bg: "#dcfce7", fg: "#166534" },
              { label: "70–89% neutral", bg: "#f3f4f6", fg: "#374151" },
              { label: "90–110% yellow", bg: "#fef9c3", fg: "#854d0e" },
              { label: ">110% red",  bg: "#fee2e2", fg: "#991b1b" },
            ].map((t) => (
              <span
                key={t.label}
                className="rounded-full px-2 py-1"
                style={{ background: t.bg, color: t.fg }}
              >
                {t.label}
              </span>
            ))}
          </div>
        </section>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? (
              <><Loader2 size={13} className="animate-spin" /> Saving…</>
            ) : saved ? (
              <><Check size={13} /> Saved</>
            ) : (
              "Save settings"
            )}
          </Button>
          {!dirty && !saving && (
            <span className="text-xs text-gray-400">No unsaved changes</span>
          )}
        </div>
      </div>
    </div>
  );
}
