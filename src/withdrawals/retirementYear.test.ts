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

  it("asks retirement savings to fund only half a year of spending", () => {
    // Salary covers January-June. Halving income without halving spending
    // would invent a large first-year RRSP draw.
    const [first, second] = run({});
    expect(first!.phase).toBe(second!.phase);
    expect(first!.targetAfterTaxSpending).toBeCloseTo(second!.targetAfterTaxSpending / 2, 2);
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
