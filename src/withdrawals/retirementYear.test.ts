import { describe, it, expect } from "vitest";
import { buildWithdrawalSchedule } from "./engine";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, projectedPensionSarah, type Variables } from "../planDefaults";

const PENSIONS = DEFAULT_ANCHORS.pensionShingo + projectedPensionSarah(DEFAULT_ANCHORS, DEFAULT_VARIABLES);

const BAL = { fhsa: 0, rrsp: 640_000, tfsa: 300_000, lira: 520_000, nonRegistered: 40_000 };

function run(overrides: Partial<Variables>) {
  const vars: Variables = {
    ...DEFAULT_VARIABLES,
    // Flat dollars, so year 1 differs from year 0 only by the partial year.
    expectedInflation: 0,
    pensionIndexRate: 0,
    pensionIndexRateShingo: 0,
    pensionIndexRateSarah: 0,
    ...overrides,
  };
  return buildWithdrawalSchedule({
    vars, anchors: DEFAULT_ANCHORS,
    retirementYear: vars.retirementYear, retirementBalances: { ...BAL },
  });
}

describe("the retirement year is half a year (both retire in July)", () => {
  it("pays half a year of pension", () => {
    const [first, second] = run({});
    expect(first!.guaranteedIncome).toBeCloseTo(PENSIONS / 2, 2);
    expect(first!.guaranteedIncome).toBeCloseTo(second!.guaranteedIncome / 2, 2);
  });

  it("budgets a FULL year of spending, like every other year", () => {
    // Income is halved in the retirement year; spending is not. You live the
    // whole calendar year and your expenses in January are the same as in
    // August. The salary that pays for January-June is counted as cash
    // instead, which is what keeps this from inventing a first-year RRSP draw.
    const [first, second] = run({});
    expect(first!.phase).toBe(second!.phase);
    expect(first!.targetAfterTaxSpending).toBeCloseTo(second!.targetAfterTaxSpending, 2);
  });

  it("pays half a year of CPP and OAS when they start at retirement", () => {
    const [first, second] = run({ cppStartAge: 65, oasStartAge: 65 });
    expect(first!.benefitsIncome).toBeGreaterThan(0);
    expect(first!.benefitsIncome).toBeCloseTo(second!.benefitsIncome / 2, 2);
  });

  it("leaves every later year whole", () => {
    const rows = run({});
    for (const r of rows.slice(1)) {
      expect(r.guaranteedIncome).toBeCloseTo(PENSIONS, 2);
    }
  });
});

describe("the retirement year is consistent with being half a year", () => {
  it("draws half a year of LIF", () => {
    // It used to draw a full year's LIF in the half year.
    const [first, second] = run({});
    const ratio = first!.withdrawals.lira / second!.withdrawals.lira;
    expect(ratio).toBeGreaterThan(0.4);
    expect(ratio).toBeLessThan(0.6);
    expect(first!.withdrawals.lira).toBeLessThanOrEqual(first!.debug.lifMaxAllowed + 1e-6);
  });

  it("taxes retirement income on top of the half-year of salary", () => {
    const rows = run({});
    const [first, second] = rows;
    expect(first!.incomeDetail.employmentShingo).toBeGreaterThan(0);
    expect(first!.debug.taxOnEmployment).toBeGreaterThan(0);
    // No salary after the retirement year.
    expect(second!.incomeDetail.employmentShingo).toBe(0);
    expect(second!.debug.taxOnEmployment).toBe(0);
  });

  it("funds the full first-year target without a first-year RRSP spike", () => {
    // Budgeting twelve months of spending against six months of retirement
    // income would force a six-figure RRSP draw in the one year taxed on top
    // of a working salary -- the most expensive place in the plan to take it.
    // Counting the salary as cash is what avoids that.
    const rows = run({});
    expect(rows[0]!.debug.shortfallAfterTax).toBeLessThanOrEqual(1);
    expect(rows[0]!.withdrawals.rrsp).toBeLessThanOrEqual(rows[1]!.withdrawals.rrsp + 1);
  });
});

describe("OAS is 10% higher from age 75", () => {
  it("steps up in the year each spouse turns 75", () => {
    const rows = run({ oasStartAge: 70, cppStartAge: 70 });
    const at74 = rows.find((r) => r.ageShingo === 74)!;
    const at75 = rows.find((r) => r.ageShingo === 75)!;
    // Flat dollars in this suite, so the only change is the age-75 increase.
    expect(at75.incomeDetail.oasShingo / at74.incomeDetail.oasShingo).toBeCloseTo(1.1, 6);
  });
});
