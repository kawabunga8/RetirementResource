import { describe, expect, it } from "vitest";
import { computeHouseholdTax, type IncomeSources } from "./v2";

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
  /*
   * Investment income, checked against hand-worked figures. Expected values are
   * computed here from the published 2025 brackets and credit rates -- not by
   * calling the engine twice -- so the test catches a wrong rule, not just a
   * change.
   */
  describe("non-registered investment income (2025, hand-worked)", () => {
    const none = { employment: 0, pensionDb: 0, rrspWithdrawal: 0, rrifWithdrawal: 0, lifWithdrawal: 0, cpp: 0, oas: 0, tfsaWithdrawal: 0 };
    // Age 60: no age amount, so the arithmetic stays visible.
    const person = (incomes: Partial<IncomeSources>, age = 60) =>
      computeHouseholdTax({
        taxYear: 2025,
        spouseA: { name: "A", age, incomes: { ...none, ...incomes } },
        spouseB: { name: "B", age, incomes: none },
        credits: { useBpa: true, useAgeAmount: true, usePensionCredit: true },
        pensionSplitting: { enabled: false, optimize: false, step: 100 },
      }).spouseA;

    it("$40,000 of eligible dividends alone is tax-free in BC (credits are non-refundable)", () => {
      // Grossed up: $55,200. Federal $8,004 < BPA + DTC credits $10,629.63.
      // BC $2,949.43 < BPA + DTC credits $7,278.36. Neither goes negative.
      const a = person({ eligibleDividends: 40_000 });
      expect(a.totalIncome).toBeCloseTo(55_200, 2);
      expect(a.totalTax).toBe(0);
      expect(a.afterTaxIncome).toBeCloseTo(40_000, 2); // cash, not the grossed-up figure
    });

    it("eligible dividends on top of a $100,000 pension cost $560.76", () => {
      // Grossed up $13,800, from $100,000 to $113,800.
      // Federal: 13,800 x 20.5% = 2,829.00, less DTC 13,800 x 15.0198% = 2,072.73 -> +756.27
      // BC: 13,158 x 10.5% + 642 x 12.29% = 1,460.49, less DTC 13,800 x 12% = 1,656.00 -> -195.51
      const base = person({ pensionDb: 100_000 });
      const withDiv = person({ pensionDb: 100_000, eligibleDividends: 10_000 });
      expect(withDiv.totalTax - base.totalTax).toBeCloseTo(560.76, 1);
      expect(withDiv.credits.fed.dividend).toBeCloseTo(2_072.73, 1);
      expect(withDiv.credits.bc.dividend).toBeCloseTo(1_656, 1);
    });

    it("non-eligible dividends on top of a $100,000 pension cost $2,301.14", () => {
      // Grossed up $11,500, from $100,000 to $111,500.
      // Federal: 11,500 x 20.5% = 2,357.50, less 11,500 x 9.0301% = 1,038.46 -> +1,319.04
      // BC: 11,500 x 10.5% = 1,207.50, less 11,500 x 1.96% = 225.40 -> +982.10
      const base = person({ pensionDb: 100_000 });
      const withDiv = person({ pensionDb: 100_000, nonEligibleDividends: 10_000 });
      expect(withDiv.totalTax - base.totalTax).toBeCloseTo(2_301.14, 1);
    });

    it("interest is taxed like any other income", () => {
      // $10,000 from $100,000: federal 20.5% = 2,050; BC 10.5% = 1,050.
      const base = person({ pensionDb: 100_000 });
      expect(person({ pensionDb: 100_000, interest: 10_000 }).totalTax - base.totalTax).toBeCloseTo(3_100, 2);
    });

    it("only half of a realized capital gain is taxable", () => {
      const gain = person({ pensionDb: 100_000, capitalGains: 20_000 });
      const interest = person({ pensionDb: 100_000, interest: 10_000 });
      expect(gain.totalIncome).toBeCloseTo(110_000, 2);
      expect(gain.totalTax).toBeCloseTo(interest.totalTax, 2);
      expect(gain.afterTaxIncome).toBeCloseTo(120_000 - gain.totalTax, 2);
    });

    it("grossed-up dividends count toward the OAS clawback", () => {
      // 85,000 + 8,800 + 13,800 = 107,600; 15% of the excess over 93,454 = 2,121.90.
      const a = person({ pensionDb: 85_000, oas: 8_800, eligibleDividends: 10_000 }, 70);
      expect(a.oasClawback).toBeCloseTo(2_121.9, 1);
    });
  });
});
