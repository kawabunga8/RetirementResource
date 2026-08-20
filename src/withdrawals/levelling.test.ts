import { describe, it, expect } from "vitest";
import { buildWithdrawalSchedule } from "./engine";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, type Variables } from "../planDefaults";

function run(overrides: Partial<Variables> = {}, balances = {}) {
  const vars: Variables = { ...DEFAULT_VARIABLES, ...overrides };
  return {
    vars,
    rows: buildWithdrawalSchedule({
      vars,
      anchors: DEFAULT_ANCHORS,
      retirementYear: vars.retirementYear,
      retirementBalances: {
        fhsa: 0, rrsp: 640_000, tfsa: 300_000, lira: 520_000, nonRegistered: 40_000,
        ...balances,
      },
    }),
  };
}

/** Mid-plan CPP/OAS start makes the baseline shift, which is what broke the old solver. */
const BENEFITS = {
  withdrawals: {
    ...DEFAULT_VARIABLES.withdrawals,
    cppShingoAnnual: 20000, cppSarahAnnual: 18000,
    oasShingoAnnual: 10000, oasSarahAnnual: 10000,
  },
};

describe("RRSP levelling actually levels", () => {
  it("drains the RRSP before the depletion year rather than leaving a lump", () => {
    const { vars, rows } = run(BENEFITS);
    const dep = rows.find((r) => r.ageShingo >= vars.withdrawals.rrifDepleteByAge)!;
    // Was ~$102,700 with the single-pass solver.
    expect(dep.debug.startBalances.rrsp).toBeLessThan(1000);
  });

  it("does not spike the depletion year above the surrounding years", () => {
    const { vars, rows } = run(BENEFITS);
    const dep = rows.find((r) => r.ageShingo >= vars.withdrawals.rrifDepleteByAge)!;
    const before = rows.filter((r) => r.year < dep.year && r.withdrawals.rrsp > 0);
    const avg = before.reduce((a, r) => a + r.withdrawals.rrsp, 0) / before.length;

    // The whole point of "auto-level": no year carries a disproportionate lump.
    expect(dep.withdrawals.rrsp).toBeLessThanOrEqual(avg * 1.05);
  });

  it("holds across a range of starting balances", () => {
    for (const rrsp of [300_000, 640_000, 1_200_000]) {
      const { vars, rows } = run(BENEFITS, { rrsp });
      const dep = rows.find((r) => r.ageShingo >= vars.withdrawals.rrifDepleteByAge)!;
      expect(dep.debug.startBalances.rrsp).toBeLessThan(rrsp * 0.02);
    }
  });

  it("still honours manual per-year overrides instead of solving", () => {
    const year = DEFAULT_VARIABLES.retirementYear + 1;
    const { rows } = run({
      withdrawals: { ...BENEFITS.withdrawals, rrspExtraByYear: { [String(year)]: 12_345 } },
    });
    const row = rows.find((r) => r.year === year)!;
    expect(row.debug.extraRrifPlanned).toBe(12_345);
  });

  it("reports the pre-overlay withdrawal separately from the total", () => {
    const { rows } = run(BENEFITS);
    for (const r of rows) {
      expect(r.debug.rrspBeforeOverlay).toBeLessThanOrEqual(r.withdrawals.rrsp + 1);
      expect(r.debug.rrspBeforeOverlay).toBeGreaterThanOrEqual(0);
    }
  });

  it("never leaves a spending shortfall it could have covered", () => {
    const { rows } = run(BENEFITS);
    expect(rows.filter((r) => r.debug.shortfallAfterTax > 1)).toEqual([]);
  });
});
