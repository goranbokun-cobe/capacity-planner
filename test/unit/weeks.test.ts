import { describe, it, expect } from "vitest";
import {
  parseWeekId,
  formatWeekId,
  getCurrentWeekId,
  weekIdToMonday,
  weekIdToRange,
  addWeeks,
  getWeeksInRange,
  dateToWeekId,
  upcomingWeeks,
} from "@/lib/weeks";

describe("parseWeekId", () => {
  it("parses a normal week", () => {
    expect(parseWeekId("2026-W23")).toEqual({ year: 2026, week: 23 });
  });

  it("parses week 1", () => {
    expect(parseWeekId("2026-W01")).toEqual({ year: 2026, week: 1 });
  });

  it("throws on bad format", () => {
    expect(() => parseWeekId("2026-23")).toThrow();
    expect(() => parseWeekId("26-W23")).toThrow();
    expect(() => parseWeekId("")).toThrow();
  });

  it("throws on week 0 and week 54", () => {
    expect(() => parseWeekId("2026-W00")).toThrow();
    expect(() => parseWeekId("2026-W54")).toThrow();
  });
});

describe("formatWeekId", () => {
  it("zero-pads single digit weeks", () => {
    expect(formatWeekId(2026, 3)).toBe("2026-W03");
  });

  it("leaves two-digit weeks alone", () => {
    expect(formatWeekId(2026, 23)).toBe("2026-W23");
  });
});

describe("weekIdToMonday", () => {
  it("returns Monday for 2026-W01", () => {
    const monday = weekIdToMonday("2026-W01");
    // ISO week 1 of 2026 starts on Mon 29 Dec 2025
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getFullYear()).toBe(2025);
    expect(monday.getMonth()).toBe(11); // December (0-indexed)
    expect(monday.getDate()).toBe(29);
  });

  it("returns Monday for 2026-W23", () => {
    const monday = weekIdToMonday("2026-W23");
    expect(monday.getDay()).toBe(1);
  });

  it("handles year boundary (week 53 of 2015)", () => {
    // 2015 has a week 53
    const monday = weekIdToMonday("2015-W53");
    expect(monday.getDay()).toBe(1);
  });
});

describe("weekIdToRange", () => {
  it("returns Mon–Sun span", () => {
    const { start, end } = weekIdToRange("2026-W23");
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0);   // Sunday (end is 23:59:59.999, still Sunday)
    // end is just before midnight Sunday, so diff is slightly under 7 days
    const diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diff).toBeGreaterThan(6);
    expect(diff).toBeLessThan(7);
  });
});

describe("addWeeks", () => {
  it("adds weeks forward", () => {
    expect(addWeeks("2026-W23", 1)).toBe("2026-W24");
    expect(addWeeks("2026-W23", 4)).toBe("2026-W27");
  });

  it("subtracts weeks backward", () => {
    expect(addWeeks("2026-W23", -1)).toBe("2026-W22");
  });

  it("crosses year boundary", () => {
    // 2026 has 53 ISO weeks; W53+1 = 2027-W01
    expect(addWeeks("2026-W53", 1)).toBe("2027-W01");
    // 2022 has 52 ISO weeks; W52+1 = 2023-W01
    expect(addWeeks("2022-W52", 1)).toBe("2023-W01");
  });

  it("handles long-year week 53", () => {
    // 2015 has 53 weeks; 2015-W53 + 1 = 2016-W01
    expect(addWeeks("2015-W53", 1)).toBe("2016-W01");
  });
});

describe("getWeeksInRange", () => {
  it("returns inclusive range", () => {
    const weeks = getWeeksInRange("2026-W23", "2026-W25");
    expect(weeks).toEqual(["2026-W23", "2026-W24", "2026-W25"]);
  });

  it("returns single week when start=end", () => {
    expect(getWeeksInRange("2026-W23", "2026-W23")).toEqual(["2026-W23"]);
  });

  it("returns empty when start > end", () => {
    expect(getWeeksInRange("2026-W25", "2026-W23")).toEqual([]);
  });

  it("crosses year boundary", () => {
    // 2026 has 53 ISO weeks, so W51→2027-W02 = 5 weeks: W51,W52,W53,2027-W01,2027-W02
    const weeks = getWeeksInRange("2026-W51", "2027-W02");
    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toBe("2026-W51");
    expect(weeks[4]).toBe("2027-W02");
  });
});

describe("dateToWeekId", () => {
  it("converts a Monday to its ISO week ID", () => {
    // 1 June 2026 is a Monday in W23
    expect(dateToWeekId(new Date(2026, 5, 1))).toBe("2026-W23");
  });

  it("converts a Sunday to the same ISO week", () => {
    // 7 June 2026 is Sunday, still W23
    expect(dateToWeekId(new Date(2026, 5, 7))).toBe("2026-W23");
  });

  it("handles ISO year boundary (31 Dec 2018 is W01 of 2019)", () => {
    expect(dateToWeekId(new Date(2018, 11, 31))).toBe("2019-W01");
  });
});

describe("getCurrentWeekId", () => {
  it("returns a valid YYYY-Www string", () => {
    const id = getCurrentWeekId();
    expect(id).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe("upcomingWeeks", () => {
  it("returns exactly n weeks", () => {
    expect(upcomingWeeks(12, "2026-W23")).toHaveLength(12);
  });

  it("starts from the given weekId", () => {
    const weeks = upcomingWeeks(3, "2026-W23");
    expect(weeks[0]).toBe("2026-W23");
    expect(weeks[2]).toBe("2026-W25");
  });
});
