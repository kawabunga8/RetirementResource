import { describe, expect, it } from "vitest";
import { computeHouseholdTax } from "./v2";

describe("tax v2", () => {
  it("a) two retirees with only DB pensions should have modest tax", () => {
    const res = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "Shingo",
        age: 67,
        incomes: {
          employment: 0,
          pensionDb: 29000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "Sarah",
        age: 65,
        incomes: {
          employment: 0,
          pensionDb: 35000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: true, optimize: true, step: 100 },
    });

    expect(res.household.totalTax).toBeGreaterThan(0);
    expect(res.household.totalTax).toBeLessThan(20000);
  });

  it("b) adding RRIF withdrawals increases tax", () => {
    const base = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "A",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 29000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "B",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 35000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: false, optimize: false, step: 100 },
    });

    const higher = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "A",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 29000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 20000,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "B",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 35000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: false, optimize: false, step: 100 },
    });

    expect(higher.household.totalTax).toBeGreaterThan(base.household.totalTax);
  });

  it("c) with splitting ON optimized, combined tax should be <= splitting OFF", () => {
    const off = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "A",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 100000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "B",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 0,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: false, optimize: false, step: 100 },
    });

    const on = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "A",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 100000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "B",
        age: 70,
        incomes: {
          employment: 0,
          pensionDb: 0,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: true, optimize: true, step: 500 },
    });

    expect(on.household.totalTax).toBeLessThanOrEqual(off.household.totalTax);
  });

  it("d) OAS clawback activates and is bounded by OAS amount", () => {
    const res = computeHouseholdTax({
      taxYear: 2025,
      spouseA: {
        name: "A",
        age: 72,
        incomes: {
          employment: 0,
          pensionDb: 140000,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 9000,
          tfsaWithdrawal: 0,
        },
      },
      spouseB: {
        name: "B",
        age: 72,
        incomes: {
          employment: 0,
          pensionDb: 0,
          rrspWithdrawal: 0,
          rrifWithdrawal: 0,
          lifWithdrawal: 0,
          cpp: 0,
          oas: 0,
          tfsaWithdrawal: 0,
        },
      },
      credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
      pensionSplitting: { enabled: false, optimize: false, step: 100 },
    });

    expect(res.spouseA.oasClawback).toBeGreaterThan(0);
    expect(res.spouseA.oasClawback).toBeLessThanOrEqual(9000);
  });
  describe("OAS repayment is deducted before tax (line 23500)", () => {
    const none = { employment: 0, pensionDb: 0, rrspWithdrawal: 0, rrifWithdrawal: 0, lifWithdrawal: 0, cpp: 0, oas: 0, tfsaWithdrawal: 0 };
    const single = (incomes: typeof none) =>
      computeHouseholdTax({
        taxYear: 2025,
        spouseA: { name: "A", age: 70, incomes },
        spouseB: { name: "B", age: 70, incomes: none },
        credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
        pensionSplitting: { enabled: false, optimize: false, step: 100 },
      }).spouseA;

    it("measures the clawback on total income, then taxes income less the repayment", () => {
      const a = single({ ...none, pensionDb: 111_200, oas: 8_800 }); // $120,000 total
      expect(a.totalIncome).toBe(120_000);
      // 2025 threshold $93,454: 15% of the $26,546 excess.
      expect(a.oasClawback).toBeCloseTo(0.15 * (120_000 - 93_454), 2);
      expect(a.taxableIncome).toBeCloseTo(120_000 - a.oasClawback, 2);

      // Regular tax equals that of someone whose whole income is the reduced figure.
      const same = single({ ...none, pensionDb: a.taxableIncome });
      expect(a.totalTax - a.oasClawback).toBeCloseTo(same.totalTax, 2);
      expect(a.afterTaxIncome).toBeCloseTo(a.totalIncome - a.totalTax, 2);
    });

    it("changes nothing below the threshold", () => {
      const a = single({ ...none, pensionDb: 60_000, oas: 8_800 });
      expect(a.oasClawback).toBe(0);
      expect(a.taxableIncome).toBe(a.totalIncome);
    });
  });
});
