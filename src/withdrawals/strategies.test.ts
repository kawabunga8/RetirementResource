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
});
