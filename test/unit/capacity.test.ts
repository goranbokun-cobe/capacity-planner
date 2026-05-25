import { describe, it, expect } from "vitest";
import {
  personCapacity,
  supplyFte,
  effectiveDemand,
  demandFte,
  calcUtilization,
  heatmapColor,
  DEFAULT_THRESHOLDS,
  type PersonData,
  type ProjectData,
} from "@/lib/capacity";

// ─── helpers ──────────────────────────────────────────────────

function person(
  overrides: Partial<PersonData> = {},
  capacityOverrides: { weekId: string; capacity: number }[] = []
): PersonData {
  return {
    id: "p1",
    seniorityId: "s1",
    baseCapacity: 1.0,
    startDate: null,
    endDate: null,
    overrides: capacityOverrides,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    status: "pipeline",
    probability: 60,
    pipelineCalcMode: null,
    ...overrides,
  };
}

// ─── personCapacity ───────────────────────────────────────────

describe("personCapacity", () => {
  it("returns baseCapacity when no override exists", () => {
    expect(personCapacity(person(), "2026-W23")).toBe(1.0);
  });

  it("override fully replaces baseCapacity", () => {
    const p = person({}, [{ weekId: "2026-W23", capacity: 0 }]);
    expect(personCapacity(p, "2026-W23")).toBe(0);
  });

  it("override for a different week does not affect target week", () => {
    const p = person({}, [{ weekId: "2026-W24", capacity: 0 }]);
    expect(personCapacity(p, "2026-W23")).toBe(1.0);
  });

  it("partial capacity override (e.g. 0.5 for training)", () => {
    const p = person({}, [{ weekId: "2026-W23", capacity: 0.5 }]);
    expect(personCapacity(p, "2026-W23")).toBe(0.5);
  });

  it("returns 0 before person's startDate", () => {
    const p = person({ startDate: new Date(2026, 8, 1) }); // Sep 2026 → W36
    expect(personCapacity(p, "2026-W23")).toBe(0);
  });

  it("returns normal capacity on or after startDate", () => {
    const p = person({ startDate: new Date(2026, 5, 1) }); // 1 Jun 2026 → W23
    expect(personCapacity(p, "2026-W23")).toBe(1.0);
    expect(personCapacity(p, "2026-W24")).toBe(1.0);
  });

  it("returns 0 after person's endDate", () => {
    const p = person({ endDate: new Date(2026, 5, 7) }); // 7 Jun 2026 → W23
    expect(personCapacity(p, "2026-W24")).toBe(0);
  });
});

// ─── supplyFte ────────────────────────────────────────────────

describe("supplyFte", () => {
  it("sums all people's capacity when no filter", () => {
    const people = [person(), person({ id: "p2", baseCapacity: 0.8 })];
    expect(supplyFte(people, "2026-W23")).toBeCloseTo(1.8);
  });

  it("filters by seniorityId", () => {
    const people = [
      person({ seniorityId: "s1" }),
      person({ id: "p2", seniorityId: "s2", baseCapacity: 0.8 }),
    ];
    expect(supplyFte(people, "2026-W23", "s1")).toBe(1.0);
    expect(supplyFte(people, "2026-W23", "s2")).toBeCloseTo(0.8);
  });

  it("returns 0 for empty list", () => {
    expect(supplyFte([], "2026-W23")).toBe(0);
  });
});

// ─── effectiveDemand ──────────────────────────────────────────

describe("effectiveDemand", () => {
  it("pipeline weighted: applies probability", () => {
    expect(
      effectiveDemand(2.0, project({ probability: 60 }), "weighted")
    ).toBeCloseTo(1.2);
  });

  it("pipeline weighted: probability 0 → 0 demand", () => {
    expect(
      effectiveDemand(2.0, project({ probability: 0 }), "weighted")
    ).toBe(0);
  });

  it("pipeline weighted: probability 100 → full demand", () => {
    expect(
      effectiveDemand(2.0, project({ probability: 100 }), "weighted")
    ).toBeCloseTo(2.0);
  });

  it("pipeline full mode: counts at 100% regardless of probability", () => {
    expect(
      effectiveDemand(2.0, project({ probability: 60 }), "full")
    ).toBe(2.0);
  });

  it("per-project override beats global default (full overrides weighted)", () => {
    const p = project({ probability: 60, pipelineCalcMode: "full" });
    // global default is "weighted", but project says "full"
    expect(effectiveDemand(2.0, p, "weighted")).toBe(2.0);
  });

  it("per-project override: weighted overrides full default", () => {
    const p = project({ probability: 60, pipelineCalcMode: "weighted" });
    expect(effectiveDemand(2.0, p, "full")).toBeCloseTo(1.2);
  });

  it("committed always 100%", () => {
    const p = project({ status: "committed", probability: 50 });
    expect(effectiveDemand(2.0, p, "weighted")).toBe(2.0);
  });

  it("running always 100%", () => {
    const p = project({ status: "running", probability: 80 });
    expect(effectiveDemand(2.0, p, "weighted")).toBe(2.0);
  });

  it("done → 0 demand", () => {
    expect(effectiveDemand(2.0, project({ status: "done" }), "weighted")).toBe(0);
  });

  it("lost → 0 demand", () => {
    expect(effectiveDemand(2.0, project({ status: "lost" }), "weighted")).toBe(0);
  });
});

// ─── demandFte ────────────────────────────────────────────────

describe("demandFte", () => {
  it("sums allocations for given week", () => {
    const allocations = [
      { seniorityId: "s1", fte: 2.0, project: project({ probability: 100 }) },
      { seniorityId: "s1", fte: 1.0, project: project({ status: "running", probability: undefined }) },
    ];
    // 2.0 * 100% + 1.0 = 3.0
    expect(demandFte(allocations, undefined, "weighted")).toBeCloseTo(3.0);
  });

  it("filters by seniorityId", () => {
    const allocations = [
      { seniorityId: "s1", fte: 2.0, project: project({ probability: 100 }) },
      { seniorityId: "s2", fte: 1.0, project: project({ probability: 100 }) },
    ];
    expect(demandFte(allocations, "s1", "weighted")).toBeCloseTo(2.0);
    expect(demandFte(allocations, "s2", "weighted")).toBeCloseTo(1.0);
  });
});

// ─── calcUtilization ──────────────────────────────────────────

describe("calcUtilization", () => {
  it("computes util% and gap correctly", () => {
    const r = calcUtilization(1.5, 2.0);
    expect(r.utilPct).toBeCloseTo(0.75);
    expect(r.gapFte).toBeCloseTo(0.5);
  });

  it("supply=0 and demand=0 → utilPct=0", () => {
    expect(calcUtilization(0, 0).utilPct).toBe(0);
  });

  it("supply=0 and demand>0 → utilPct=Infinity", () => {
    expect(calcUtilization(1, 0).utilPct).toBe(Infinity);
  });

  it("rounds to 1 decimal", () => {
    const r = calcUtilization(1.05, 2.0);
    expect(r.demand).toBe(1.1); // rounded
    expect(r.supply).toBe(2.0);
  });
});

// ─── heatmapColor ────────────────────────────────────────────

describe("heatmapColor", () => {
  const t = DEFAULT_THRESHOLDS; // greenMax=69, neutralMax=89, yellowMax=110

  it("0%   → green", () => expect(heatmapColor(0, t)).toBe("green"));
  it("69%  → green", () => expect(heatmapColor(0.69, t)).toBe("green"));
  it("70%  → neutral", () => expect(heatmapColor(0.70, t)).toBe("neutral"));
  it("89%  → neutral", () => expect(heatmapColor(0.89, t)).toBe("neutral"));
  it("90%  → yellow", () => expect(heatmapColor(0.90, t)).toBe("yellow"));
  it("110% → yellow", () => expect(heatmapColor(1.10, t)).toBe("yellow"));
  it("111% → red",    () => expect(heatmapColor(1.11, t)).toBe("red"));
  it("∞   → red",    () => expect(heatmapColor(Infinity, t)).toBe("red"));
});
