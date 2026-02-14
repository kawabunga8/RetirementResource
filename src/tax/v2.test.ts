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
});
