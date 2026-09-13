import { describe, it, expect } from "vitest";
import { incomeGrowthFactor, pensionRaiseFactor } from "./incomeGrowth";
import { newRrspRoomForYear, RRSP_ROOM_RATE } from "./rrspRoom";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, projectedPensionSarah } from "./planDefaults";
import { buildWithdrawalSchedule } from "./withdrawals/engine";

describe("Sarah's pension reflects her raises", () => {
  it("lifts the pension by the rise in her final five-year average", () => {
    // Retiring in 2036: average of 2031-2035 pay, 6 to 10 raises past 2025.
    const expected = [6, 7, 8, 9, 10].reduce((s, n) => s + Math.pow(1.02, n), 0) / 5;
    expect(pensionRaiseFactor({ statementYear: 2025, retirementYear: 2036, growthRate: 0.02 }))
      .toBeCloseTo(expected, 10);
  });

  it("is the statement figure when there are no raises", () => {
    expect(projectedPensionSarah(DEFAULT_ANCHORS, { ...DEFAULT_VARIABLES, incomeGrowthRate: 0 }))
      .toBeCloseTo(DEFAULT_ANCHORS.pensionSarah, 6);
  });

  it("puts ~$50,000 a year in the plan at 2% raises, not the statement's $42,744", () => {
    const p = projectedPensionSarah(DEFAULT_ANCHORS, DEFAULT_VARIABLES);
    expect(p).toBeGreaterThan(49_000);
    expect(p).toBeLessThan(51_000);
  });

  it("leaves Shingo's pension alone -- PENCAN's figure already assumes 2% raises", () => {
    const vars = { ...DEFAULT_VARIABLES, expectedInflation: 0, pensionIndexRateShingo: 0, pensionIndexRateSarah: 0 };
    const rows = buildWithdrawalSchedule({
      vars, anchors: DEFAULT_ANCHORS, retirementYear: vars.retirementYear,
      retirementBalances: { fhsa: 0, rrsp: 640_000, tfsa: 300_000, lira: 520_000, nonRegistered: 40_000 },
    });
    expect(rows[1]!.guaranteedIncome).toBeCloseTo(
      DEFAULT_ANCHORS.pensionShingo + projectedPensionSarah(DEFAULT_ANCHORS, vars), 2
    );
  });
});

describe("working income grows each year", () => {
  it("assumes a 2% raise by default", () => {
    expect(DEFAULT_VARIABLES.incomeGrowthRate).toBe(0.02);
  });

  it("compounds from the year the figure is from", () => {
    expect(incomeGrowthFactor({ asOfYear: 2025, year: 2025, growthRate: 0.02 })).toBe(1);
    expect(incomeGrowthFactor({ asOfYear: 2025, year: 2035, growthRate: 0.02 })).toBeCloseTo(
      Math.pow(1.02, 10), 10
    );
  });

  it("never discounts a figure for years before it", () => {
    expect(incomeGrowthFactor({ asOfYear: 2026, year: 2024, growthRate: 0.02 })).toBe(1);
  });
});

describe("new RRSP room follows the raises", () => {
  const EARNED = 98591;
  const PA = 16275;
  const base = {
    earnedIncome: EARNED,
    pensionAdjustment: PA,
    rrspDollarLimit: 33810,
    rrspDollarLimitYear: 2026,
    annualInflation: 0.02,
    incomeAsOfYear: 2025,
    incomeGrowthRate: 0.02,
  };

  it("is earned on the prior year's pay", () => {
    // Room created 1 Jan 2026 is earned on 2025 income: no growth yet.
    expect(newRrspRoomForYear({ ...base, year: 2026 })).toBeCloseTo(EARNED * RRSP_ROOM_RATE - PA, 6);
    // Room created 1 Jan 2027 is earned on 2026 income: one raise.
    expect(newRrspRoomForYear({ ...base, year: 2027 })).toBeCloseTo(
      (EARNED * RRSP_ROOM_RATE - PA) * 1.02, 6
    );
  });

  it("grows income and pension adjustment together", () => {
    // If only income grew, room would jump by 18% of each raise (~$355 in
    // 2027) instead of 2% of the net room (~$29).
    const r2030 = newRrspRoomForYear({ ...base, year: 2030 });
    const r2031 = newRrspRoomForYear({ ...base, year: 2031 });
    expect(r2031 / r2030).toBeCloseTo(1.02, 10);
  });

  it("matches the flat model when there are no raises", () => {
    expect(newRrspRoomForYear({ ...base, year: 2031, incomeGrowthRate: 0 })).toBeCloseTo(
      EARNED * RRSP_ROOM_RATE - PA, 6
    );
  });
});
