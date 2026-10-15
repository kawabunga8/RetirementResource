import { describe, expect, it } from "vitest";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES } from "../planDefaults";
import { buildWithdrawalSchedule, type RetirementBalances } from "./engine";
import {
  ownershipFromBalances,
  pooledCapWithoutSplitting,
  shareAfterFhsaRollover,
} from "./ownership";

describe("ownership of the pooled registered accounts", () => {
  it("weights each pot by who holds it", () => {
    const o = ownershipFromBalances({ rrspShingo: 300, rrspSarah: 100, fhsaShingo: 50, fhsaSarah: 50 });
    expect(o.rrspShingo).toBeCloseTo(0.75);
    expect(o.fhsaShingo).toBeCloseTo(0.5);
  });

  it("falls back to an even split only when a pot is empty", () => {
    expect(ownershipFromBalances({ rrspShingo: 0, rrspSarah: 0, fhsaShingo: 0, fhsaSarah: 0 }).rrspShingo).toBe(0.5);
  });

  it("re-weights the RRSP share when the FHSA rolls in", () => {
    // $300k RRSP at 80% Shingo + $100k FHSA at 40% Shingo = $280k of $400k.
    expect(shareAfterFhsaRollover(300_000, 0.8, 100_000, 0.4)).toBeCloseTo(0.7);
  });

  it("caps a pooled withdrawal at whoever runs out of headroom first", () => {
    // Even split: the old hard-coded rule, 2 x the smaller headroom.
    expect(pooledCapWithoutSplitting(10_000, 30_000, 0.5)).toBeCloseTo(20_000);
    // 75% to Shingo: he fills $10k of headroom after $13,333.
    expect(pooledCapWithoutSplitting(10_000, 30_000, 0.75)).toBeCloseTo(13_333.33, 1);
    // All Shingo's: Sarah's headroom never binds.
    expect(pooledCapWithoutSplitting(10_000, 0, 1)).toBeCloseTo(10_000);
  });
});

describe("the engine taxes RRIF income to its owner", () => {
  const vars = {
    ...DEFAULT_VARIABLES,
    expectedInflation: 0,
    expectedNominalReturn: 0,
    retirementNominalReturn: 0,
    retirementYear: 2036,
    // Without splitting, nothing can move the income once it lands.
    tax: { ...DEFAULT_VARIABLES.tax, enablePensionSplitting: false },
    phaseAges: { goGoEndAge: 70, slowGoEndAge: 70, endAge: 70 },
  };
  const balances: RetirementBalances = { fhsa: 0, rrsp: 600_000, tfsa: 0, lira: 0, nonRegistered: 0 };

  const run = (ownership?: { rrspShingo: number; fhsaShingo: number }) =>
    buildWithdrawalSchedule({
      vars,
      anchors: DEFAULT_ANCHORS,
      retirementYear: vars.retirementYear,
      retirementBalances: { ...balances },
      ownership,
    });

  it("an even split matches the old behaviour exactly", () => {
    const before = run();
    const even = run({ rrspShingo: 0.5, fhsaShingo: 0.5 });
    expect(even.map((r) => r.debug.tax)).toEqual(before.map((r) => r.debug.tax));
  });

  it("puts more of the taxable income on the spouse who owns more", () => {
    const row = run({ rrspShingo: 0.8, fhsaShingo: 0.5 })[2]!;
    const evenRow = run()[2]!;
    expect(row.ownership.rrspShingo).toBeCloseTo(0.8);
    expect(row.debug.taxableIncomeShingo - evenRow.debug.taxableIncomeShingo).toBeGreaterThan(0);
    expect(row.debug.taxableIncomeSarah).toBeLessThan(evenRow.debug.taxableIncomeSarah);
  });

  it("reports the rolled-in share after the FHSA joins the RRSP", () => {
    const rows = buildWithdrawalSchedule({
      vars,
      anchors: DEFAULT_ANCHORS,
      retirementYear: vars.retirementYear,
      retirementBalances: { ...balances, rrsp: 300_000, fhsa: 100_000 },
      ownership: { rrspShingo: 0.8, fhsaShingo: 0.4 },
    });
    expect(rows[0]!.ownership.rrspShingo).toBeCloseTo(0.7);
  });
});
