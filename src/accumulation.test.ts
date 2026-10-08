import { describe, it, expect } from "vitest";
import { buildAccumulationSchedule, monthlyRateFromAnnual } from "./accumulation";
import { tfsaLimitForYear } from "./tfsaRoom";

const ZERO_BAL = {
  fhsaShingo: 0, fhsaSarah: 0, rrspShingo: 0, rrspSarah: 0,
  tfsaShingo: 0, tfsaSarah: 0, liraShingo: 0, nonRegistered: 0,
};

function run(overrides: Partial<Parameters<typeof buildAccumulationSchedule>[0]> = {}) {
  return buildAccumulationSchedule({
    baselineYear: 2026,
    retirementYear: 2036,
    annualReturn: 0.07,
    ...ZERO_BAL,
    tfsaRoomShingo: 0, tfsaRoomSarah: 0, rrspRoomShingo: 0, rrspRoomSarah: 0,
    earnedIncomeShingo: 0, earnedIncomeSarah: 0, earnedIncomeYear: 2025,
    incomeGrowthRate: 0, rrspDollarLimit: 33810, rrspDollarLimitYear: 2026,
    pensionAdjustmentShingo: 0, pensionAdjustmentSarah: 0,
    annualInflation: 0.03, nonRegTaxDragRate: 0,
    monthlyFhsaShingo: 0, monthlyFhsaSarah: 0, monthlyRrspShingo: 0, monthlyRrspSarah: 0, monthlyTfsaTotal: 0,
    fhsaAnnualLimit: 8000, fhsaLifetimeCap: 40000, fhsaContributedToDateShingo: 40000, fhsaContributedToDateSarah: 40000,
    incomeShingo: 0, incomeSarah: 0, tfsaIncludesRefund: false,
    workingMonthsInRetirementYear: 6,
    ...overrides,
  });
}

describe("returns compound to the stated annual rate", () => {
  it("grows a balance by exactly 7% a year, not 7.23%", () => {
    const rows = run({ liraShingo: 100_000 });
    expect(rows[0]!.endLira).toBeCloseTo(107_000, 6);
    expect(monthlyRateFromAnnual(0.07)).toBeCloseTo(Math.pow(1.07, 1 / 12) - 1, 12);
  });
});

describe("TFSA room keeps growing after the published table ends", () => {
  it("indexes the last published limit and rounds to $500", () => {
    expect(tfsaLimitForYear(2026, 0.03)).toBe(7000);
    expect(tfsaLimitForYear(2027, 0.03)).toBe(7000); // 7,210 rounds down
    expect(tfsaLimitForYear(2028, 0.03)).toBe(7500); // 7,426 rounds up
    expect(tfsaLimitForYear(2036, 0)).toBe(7000);
  });

  it("adds new room every January in the projection", () => {
    // It used to add $0 a year from 2027 on.
    const rows = run({ tfsaRoomShingo: 1000, tfsaRoomSarah: 1000 });
    const y2036 = rows.find((r) => r.year === 2036)!;
    let expected = 1000;
    for (let y = 2027; y <= 2036; y++) expected += tfsaLimitForYear(y, 0.03);
    expect(y2036.startOfYear!.room.tfsaShingo).toBeCloseTo(expected, 6);
  });
});

describe("the retirement year's working months are saved", () => {
  it("ends at June of the retirement year with six months of contributions", () => {
    const rows = run({ monthlyTfsaTotal: 1000, tfsaRoomShingo: 1e6, tfsaRoomSarah: 1e6 });
    const last = rows[rows.length - 1]!;
    expect(last.year).toBe(2036);
    expect(last.months).toBe(6);
    expect(last.tfsaContribTotal).toBeCloseTo(6000, 6);
  });

  it("stops at December of the year before when no months are worked", () => {
    const rows = run({ workingMonthsInRetirementYear: 0 });
    expect(rows[rows.length - 1]!.year).toBe(2035);
  });
});

describe("the start-of-year position matches the previous year's end", () => {
  it("is last December's balances, with only the new room added", () => {
    const rows = run({
      liraShingo: 50_000, monthlyRrspShingo: 500, rrspRoomShingo: 1e6,
      tfsaRoomShingo: 10_000, workingMonthsInRetirementYear: 6,
    });
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const start = rows[i]!.startOfYear!;
      expect(start.balances.rrspShingo).toBeCloseTo(prev.end.balances.rrspShingo, 6);
      expect(start.balances.liraShingo).toBeCloseTo(prev.end.balances.liraShingo, 6);
      expect(start.room.tfsaShingo - prev.end.room.tfsaShingo).toBeCloseTo(
        tfsaLimitForYear(rows[i]!.year, 0.03), 6
      );
    }
  });
});
