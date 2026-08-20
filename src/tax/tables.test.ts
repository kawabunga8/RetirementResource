import { describe, it, expect } from "vitest";
import { TAX_TABLES, pickTaxTables } from "./tables";

describe("built-in tax tables are the only source", () => {
  it("ships both published years", () => {
    expect(TAX_TABLES.map((t) => t.year)).toEqual([2025, 2026]);
  });

  it("uses the newest published year for any later projection year", () => {
    // The live symptom of the old DB override: 2036 resolved to 2025.
    for (const y of [2026, 2030, 2036, 2050, 2059]) {
      expect(pickTaxTables(y).year).toBe(2026);
    }
  });

  it("has the correct 2026 bottom rates", () => {
    const t = pickTaxTables(2026);
    // Federal cut to 14% permanently; BC raised 5.06% -> 5.60% for 2026.
    expect(t.federal.brackets[0]!.rate).toBeCloseTo(0.14, 10);
    expect(t.bc.brackets[0]!.rate).toBeCloseTo(0.056, 10);
    expect(t.federal.bpa).toBe(16452);
    expect(t.federal.oasClawbackThreshold).toBe(95323);
  });

  it("has the correct 2025 bottom rates", () => {
    const t = pickTaxTables(2025);
    // 14.5% is the blend of 15% (Jan-Jun) and 14% (Jul-Dec) 2025.
    expect(t.federal.brackets[0]!.rate).toBeCloseTo(0.145, 10);
    expect(t.bc.brackets[0]!.rate).toBeCloseTo(0.0506, 10);
  });

  it("keeps the pension amount at its statutory, unindexed values", () => {
    for (const t of TAX_TABLES) {
      expect(t.federal.pensionCreditBase).toBe(2000);
      expect(t.bc.pensionCreditBase).toBe(1000);
    }
  });

  it("phases out the age amount at 15% in both jurisdictions", () => {
    // The database had BC at 0.0340, which barely phased the credit out at all.
    for (const t of TAX_TABLES) {
      expect(t.federal.ageAmountPhaseOutRate).toBeCloseTo(0.15, 10);
      expect(t.bc.ageAmountPhaseOutRate).toBeCloseTo(0.15, 10);
    }
  });
});
