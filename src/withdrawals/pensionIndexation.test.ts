import { describe, it, expect } from "vitest";
import { buildWithdrawalSchedule } from "./engine";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, type Variables } from "../planDefaults";

const BAL = { fhsa: 0, rrsp: 640_000, tfsa: 300_000, lira: 520_000, nonRegistered: 40_000 };

function run(overrides: Partial<Variables>) {
  const vars: Variables = { ...DEFAULT_VARIABLES, ...overrides };
  return buildWithdrawalSchedule({
    vars, anchors: DEFAULT_ANCHORS,
    retirementYear: vars.retirementYear, retirementBalances: { ...BAL },
  });
}

describe("each pension indexes at its own rate", () => {
  it("holds an unindexed pension flat in nominal terms", () => {
    const rows = run({ pensionIndexRateShingo: 0, pensionIndexRateSarah: 0 });
    const first = rows[0]!.guaranteedIncome;
    const last = rows[rows.length - 1]!.guaranteedIncome;
    // Both flat => the cheque never changes, however many years pass.
    expect(last).toBeCloseTo(first, 4);
  });

  it("grows an indexed pension at its stated rate", () => {
    const rows = run({ pensionIndexRateShingo: 0.02, pensionIndexRateSarah: 0.02 });
    const a = rows[0]!;
    const b = rows[rows.length - 1]!;
    expect(b.guaranteedIncome / a.guaranteedIncome).toBeCloseTo(
      Math.pow(1.02, b.year - a.year), 4
    );
  });

  it("mixes the two rather than averaging them", () => {
    // The old model summed both pensions and applied ONE rate, so this case
    // could not be expressed at all.
    const mixed = run({ pensionIndexRateShingo: 0, pensionIndexRateSarah: 0.02 });
    const bothOff = run({ pensionIndexRateShingo: 0, pensionIndexRateSarah: 0 });
    const bothOn = run({ pensionIndexRateShingo: 0.02, pensionIndexRateSarah: 0.02 });

    const at = (rows: ReturnType<typeof run>) => rows[rows.length - 1]!.guaranteedIncome;
    expect(at(mixed)).toBeGreaterThan(at(bothOff));
    expect(at(mixed)).toBeLessThan(at(bothOn));

    // Shingo's share stays flat; only Sarah's grows.
    const last = mixed[mixed.length - 1]!;
    const years = last.year - DEFAULT_ANCHORS.baselineYear;
    const expected =
      DEFAULT_ANCHORS.pensionShingo +
      DEFAULT_ANCHORS.pensionSarah * Math.pow(1.02, years);
    expect(last.guaranteedIncome).toBeCloseTo(expected, 2);
  });

  it("falls back to the shared rate when no per-person rate is given", () => {
    const rows = run({
      pensionIndexRate: 0.015,
      pensionIndexRateShingo: undefined,
      pensionIndexRateSarah: undefined,
    });
    const last = rows[rows.length - 1]!;
    const years = last.year - DEFAULT_ANCHORS.baselineYear;
    const expected =
      (DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah) * Math.pow(1.015, years);
    expect(last.guaranteedIncome).toBeCloseTo(expected, 2);
  });

  it("ships with Shingo's pension unindexed", () => {
    // PENCAN pays a fixed cheque; the 2% previously applied was a salary-
    // escalation assumption, not post-retirement indexation.
    expect(DEFAULT_VARIABLES.pensionIndexRateShingo).toBe(0);
  });
});
