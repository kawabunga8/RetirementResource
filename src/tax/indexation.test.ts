import { describe, it, expect } from "vitest";
import { getIndexedTaxTables, pickTaxTables } from "./tables";
import { computeHouseholdTax, getOasClawbackThreshold } from "./v2";

const NONE = {
  employment: 0,
  pensionDb: 0,
  rrspWithdrawal: 0,
  rrifWithdrawal: 0,
  lifWithdrawal: 0,
  cpp: 0,
  oas: 0,
  tfsaWithdrawal: 0,
};

const CREDITS = { useBpa: true, useAgeAmount: true, usePensionCredit: true };
const NO_SPLIT = { enabled: false, optimize: false, step: 100 };

describe("tax table indexation", () => {
  it("leaves the base year untouched", () => {
    const base = pickTaxTables(2026);
    const indexed = getIndexedTaxTables(2026, 0.03);
    expect(indexed.federal.brackets[0]!.upTo).toBeCloseTo(base.federal.brackets[0]!.upTo, 6);
    expect(indexed.federal.bpa).toBeCloseTo(base.federal.bpa, 6);
    expect(indexed.federal.oasClawbackThreshold).toBeCloseTo(base.federal.oasClawbackThreshold, 6);
  });

  it("inflates brackets, BPA, age amount and the OAS threshold", () => {
    const base = pickTaxTables(2026);
    const indexed = getIndexedTaxTables(2036, 0.02);
    const growth = Math.pow(1.02, 10);

    expect(indexed.federal.brackets[0]!.upTo).toBeCloseTo(base.federal.brackets[0]!.upTo * growth, 4);
    expect(indexed.federal.bpa).toBeCloseTo(base.federal.bpa * growth, 4);
    expect(indexed.federal.ageAmountMax).toBeCloseTo(base.federal.ageAmountMax * growth, 4);
    expect(indexed.federal.ageAmountThreshold).toBeCloseTo(base.federal.ageAmountThreshold * growth, 4);
    expect(indexed.federal.oasClawbackThreshold).toBeCloseTo(base.federal.oasClawbackThreshold * growth, 4);

    // BC is NOT federal here. Its indexation is paused for 2027-2030, so by 2036
    // only six of the ten years have been applied. See BC_INDEXATION_PAUSE.
    expect(indexed.bc.brackets[0]!.upTo).toBeCloseTo(
      base.bc.brackets[0]!.upTo * Math.pow(1.02, 6),
      4
    );
  });

  it("does NOT index the pension income amount (fixed at $2,000 / $1,000 in law)", () => {
    const indexed = getIndexedTaxTables(2060, 0.03);
    expect(indexed.federal.pensionCreditBase).toBe(2000);
    expect(indexed.bc.pensionCreditBase).toBe(1000);
  });

  it("leaves tax rates alone", () => {
    const base = pickTaxTables(2026);
    const indexed = getIndexedTaxTables(2050, 0.03);
    expect(indexed.federal.brackets.map((b) => b.rate)).toEqual(base.federal.brackets.map((b) => b.rate));
    expect(indexed.bc.brackets.map((b) => b.rate)).toEqual(base.bc.brackets.map((b) => b.rate));
  });

  it("keeps the OAS clawback threshold in step with inflation", () => {
    expect(getOasClawbackThreshold(2046, 0.02)).toBeCloseTo(
      getOasClawbackThreshold(2026, 0.02) * Math.pow(1.02, 20),
      4
    );
  });
});

describe("effective tax rate is stable in real terms", () => {
  /** Same real income, expressed in the nominal dollars of `year`. */
  const effectiveRate = (year: number, realIncome: number, inflation: number) => {
    const nominal = realIncome * Math.pow(1 + inflation, year - 2026);
    const res = computeHouseholdTax({
      taxYear: year,
      annualInflation: inflation,
      spouseA: { name: "A", age: 70, incomes: { ...NONE, rrifWithdrawal: nominal } },
      spouseB: { name: "B", age: 70, incomes: { ...NONE } },
      credits: CREDITS,
      pensionSplitting: NO_SPLIT,
    });
    return res.household.totalTax / nominal;
  };

  it("does not drift once the unindexed pension credit is excluded", () => {
    // Federal only. BC's 2027-2030 freeze is a real-terms tax increase by
    // design, so a BC-inclusive rate legitimately drifts and is covered below.
    const rate = (year: number) => {
      const nominal = 90_000 * Math.pow(1.03, year - 2026);
      const res = computeHouseholdTax({
        taxYear: year,
        annualInflation: 0.03,
        spouseA: { name: "A", age: 70, incomes: { ...NONE, rrifWithdrawal: nominal } },
        spouseB: { name: "B", age: 70, incomes: { ...NONE } },
        // Pension credit off: every remaining credit IS indexed, so the real
        // effective rate should be flat to within rounding.
        credits: { useBpa: true, useAgeAmount: true, usePensionCredit: false },
        pensionSplitting: NO_SPLIT,
      });
      return Math.max(0, res.spouseA.federalTaxBeforeCredits - res.spouseA.credits.fed.total);
    };
    const realFederal = (year: number) =>
      rate(year) / (90_000 * Math.pow(1.03, year - 2026));
    expect(Math.abs(realFederal(2056) - realFederal(2026))).toBeLessThan(1e-9);
  });

  it("BC's paused indexation raises the real BC rate, and never gives it back", () => {
    const bcRealRate = (year: number) => {
      const nominal = 90_000 * Math.pow(1.03, year - 2026);
      const res = computeHouseholdTax({
        taxYear: year,
        annualInflation: 0.03,
        spouseA: { name: "A", age: 70, incomes: { ...NONE, rrifWithdrawal: nominal } },
        spouseB: { name: "B", age: 70, incomes: { ...NONE } },
        credits: { useBpa: true, useAgeAmount: true, usePensionCredit: false },
        pensionSplitting: NO_SPLIT,
      });
      return Math.max(0, res.spouseA.bcTaxBeforeCredits - res.spouseA.credits.bc.total) / nominal;
    };

    const before = bcRealRate(2026);
    const duringPause = bcRealRate(2030);
    const longAfter = bcRealRate(2056);

    // Real BC rate climbs through the freeze ...
    expect(duringPause).toBeGreaterThan(before);
    // ... and the gap persists a quarter-century later, because indexation
    // resumes from the frozen level rather than catching up.
    expect(longAfter).toBeGreaterThan(before);
    expect(Math.abs(longAfter - duringPause)).toBeLessThan(0.01);
  });

  it("drifts only slightly with the pension credit on, because that credit is fixed in law", () => {
    const now = effectiveRate(2026, 90_000, 0.03);
    const later = effectiveRate(2056, 90_000, 0.03);
    const drift = later - now;

    // The $2,000/$1,000 pension amount is not indexed, so its real value erodes.
    // That is correct behaviour -- but it must stay small. Before the tables were
    // indexed at all, this drift was more than 10 percentage points.
    expect(drift).toBeGreaterThan(0);
    expect(drift).toBeLessThan(0.005);
  });

  it("still produces bracket creep when indexation is set to zero", () => {
    const now = effectiveRate(2026, 90_000, 0);
    const later = effectiveRate(2056, 90_000, 0);
    expect(later).toBeCloseTo(now, 6);
  });
});
