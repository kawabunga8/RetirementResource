import { describe, expect, it } from "vitest";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES } from "../planDefaults";
import { makeWithdrawalSimulator, type RetirementBalances } from "./engine";
import { NEVER_DEPLETE, solveAllStrategies, terminalTax, type StrategyContext } from "./strategies";

/**
 * A realistic plan. These balances are the ones the accumulation leaves at
 * retirement for the default inputs; the point of the tests is the SHAPE of
 * each strategy, not the exact dollars.
 */
function context(): StrategyContext {
  const vars = { ...DEFAULT_VARIABLES, retirementYear: 2036 };
  const retirementBalances: RetirementBalances = {
    fhsa: 164_678,
    rrsp: 366_504,
    tfsa: 184_461,
    lira: 400_391,
    nonRegistered: 1,
  };

  const simulate = makeWithdrawalSimulator({
    vars,
    anchors: DEFAULT_ANCHORS,
    retirementYear: 2036,
    retirementBalances,
    tfsaRoomAtRetirement: 243_380,
  });

  return {
    simulate,
    retirementYear: 2036,
    depleteAge: vars.withdrawals.rrifDepleteByAge,
    endAge: vars.phaseAges.endAge,
    frontLoad: vars.withdrawals.rrifFrontLoad,
    growth: vars.expectedNominalReturn,
    rrspAtRetirement: retirementBalances.rrsp + retirementBalances.fhsa,
    skipRetirementYear: false,
  };
}

describe("withdrawal strategies", () => {
  const ctx = context();
  const solved = solveAllStrategies(ctx, "max");

  it("solves all four and funds the spending target in every year", () => {
    expect(Object.keys(solved)).toHaveLength(4);
    for (const s of Object.values(solved)) {
      expect(s.rows.length).toBeGreaterThan(20);
      const short = s.rows.filter((r) => r.debug.shortfallAfterTax > 1);
      expect(short).toHaveLength(0);
    }
  });

  it("only the deplete-by strategy uses the plan's deplete-by age", () => {
    expect(solved.depleteBy.depleteByAge).toBe(ctx.depleteAge);
    for (const key of ["levelTax", "levelRate", "minLifetime"] as const) {
      expect(solved[key].depleteByAge).not.toBe(ctx.depleteAge);
    }
  });

  it("produces genuinely different RRIF schedules, not four copies", () => {
    const signature = (key: keyof typeof solved) =>
      solved[key].rows.map((r) => Math.round(r.withdrawals.rrsp / 1000)).join(",");
    const seen = new Set(
      (["depleteBy", "levelTax", "levelRate", "minLifetime"] as const).map(signature)
    );
    expect(seen.size).toBe(4);
  });

  it("levelling actually levels: a flatter tax line than the baseline", () => {
    expect(solved.levelTax.summary.taxSpread).toBeLessThan(solved.depleteBy.summary.taxSpread);
  });

  it("no strategy leaves a lump for the depletion year to dump", () => {
    for (const s of Object.values(solved)) {
      if (s.depleteByAge >= NEVER_DEPLETE) continue;
      const peak = s.summary.peakTax;
      const median = [...s.rows.map((r) => r.debug.tax)].sort((a, b) => a - b)[
        Math.floor(s.rows.length / 2)
      ]!;
      // A forced-depletion lump shows up as a year several times the median.
      expect(peak).toBeLessThan(median * 3);
    }
  });

  it("levelling may not buy a flat line by leaving money to the estate", () => {
    for (const key of ["levelTax", "levelRate"] as const) {
      expect(terminalTax(solved[key].rows)).toBeLessThan(5_000);
    }
  });

  it("deplete-by meets its deadline AND stays out of the OAS clawback", () => {
    const s = solved.depleteBy;
    // The deadline is still the hard constraint.
    expect(s.depleteByAge).toBe(ctx.depleteAge);
    const atDeadline = s.rows.find((r) => r.ageShingo >= ctx.depleteAge);
    expect(atDeadline).toBeDefined();
    expect(atDeadline!.endBalances.rrsp).toBeLessThan(5_000);

    // Inside that deadline it no longer walks into the recovery tax. The flat
    // amortisation it replaced paid clawback in four consecutive years.
    const clawback = s.rows.reduce(
      (a, r) => a + r.debug.oasClawbackShingo + r.debug.oasClawbackSarah,
      0
    );
    expect(clawback).toBeLessThan(1_000);
  });

  it("no strategy dumps the overlay into the retirement year", () => {
    // The retirement year is excluded from the level-ness signal. Reading its
    // missing value as a zero tax bill once made it look like the cheapest year
    // in the plan, and the solver poured the whole overlay into it.
    for (const s of Object.values(solved)) {
      const first = s.rows[0]!;
      expect(first.year).toBe(ctx.retirementYear);
      const rest = s.rows.slice(1).map((r) => r.withdrawals.rrsp);
      expect(first.withdrawals.rrsp).toBeLessThanOrEqual(Math.max(...rest));
    }
  });

  it("no strategy pays a fortune for a rounding error in its own objective", () => {
    // Horizons can differ in the objective by a whisker while differing in tax
    // by tens of thousands. Whatever a strategy optimises for, it may not cost
    // wildly more than the baseline to get a result that is barely different.
    const baseline = solved.depleteBy.summary.lifetimeTax;
    for (const key of ["levelTax", "levelRate"] as const) {
      expect(solved[key].summary.lifetimeTax - baseline).toBeLessThan(40_000);
    }
  });
});
