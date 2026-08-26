import { describe, it, expect } from "vitest";
import { bcIndexedYears, getIndexedTaxTables, BC_INDEXATION_PAUSE } from "./tables";

describe("BC indexation pause (2027-2030)", () => {
  it("counts no indexation steps across the frozen years", () => {
    expect(bcIndexedYears(2026, 2026)).toBe(0);
    expect(bcIndexedYears(2026, 2027)).toBe(0);
    expect(bcIndexedYears(2026, 2030)).toBe(0);
  });

  it("resumes in 2031 from the frozen level, not from a catch-up", () => {
    expect(bcIndexedYears(2026, 2031)).toBe(1);
    expect(bcIndexedYears(2026, 2035)).toBe(5);
    // Ten calendar years later, only six of them indexed.
    expect(bcIndexedYears(2026, 2036)).toBe(6);
  });

  it("holds BC brackets flat through the pause while federal keeps rising", () => {
    const a = getIndexedTaxTables(2026, 0.02);
    const b = getIndexedTaxTables(2030, 0.02);
    expect(b.bc.brackets[0].upTo).toBeCloseTo(a.bc.brackets[0].upTo, 6);
    expect(b.bc.bpa).toBeCloseTo(a.bc.bpa, 6);
    expect(b.federal.brackets[0].upTo).toBeGreaterThan(a.federal.brackets[0].upTo * 1.07);
  });

  it("freezes credits too, not only bracket thresholds", () => {
    const a = getIndexedTaxTables(2026, 0.02);
    const b = getIndexedTaxTables(2029, 0.02);
    expect(b.bc.ageAmountMax).toBeCloseTo(a.bc.ageAmountMax, 6);
    expect(b.bc.ageAmountThreshold).toBeCloseTo(a.bc.ageAmountThreshold, 6);
  });

  it("leaves the shortfall in place permanently after 2031", () => {
    const paused = getIndexedTaxTables(2040, 0.02).bc.brackets[0].upTo;
    const unpaused = getIndexedTaxTables(2026, 0.02).bc.brackets[0].upTo * Math.pow(1.02, 14);
    // Four missing years of 2% compounding, never repaid.
    expect(paused / unpaused).toBeCloseTo(Math.pow(1.02, -4), 6);
    expect(BC_INDEXATION_PAUSE.lastYear).toBe(2030);
  });
});
