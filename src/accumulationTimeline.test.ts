import { describe, it, expect } from "vitest";
import { buildAccumulationSchedule } from "./accumulation";
import { accumulationTimeline, monthLabel, timelineTicks } from "./accumulationTimeline";

const BAL = {
  fhsaShingo: 0, fhsaSarah: 0, rrspShingo: 0, rrspSarah: 0,
  tfsaShingo: 0, tfsaSarah: 0, liraShingo: 100_000, nonRegistered: 0,
};

function schedule(balancesAsOf: string) {
  return buildAccumulationSchedule({
    baselineYear: 2026,
    retirementYear: 2036,
    annualReturn: 0.07,
    ...BAL,
    tfsaRoomShingo: 0, tfsaRoomSarah: 0, rrspRoomShingo: 0, rrspRoomSarah: 0,
    earnedIncomeShingo: 0, earnedIncomeSarah: 0, earnedIncomeYear: 2025,
    incomeGrowthRate: 0, rrspDollarLimit: 33810, rrspDollarLimitYear: 2026,
    pensionAdjustmentShingo: 0, pensionAdjustmentSarah: 0,
    annualInflation: 0.03, nonRegTaxDragRate: 0,
    monthlyFhsaShingo: 0, monthlyFhsaSarah: 0, monthlyRrspShingo: 0, monthlyRrspSarah: 0, monthlyTfsaTotal: 0,
    fhsaAnnualLimit: 8000, fhsaLifetimeCap: 40000, fhsaContributedToDateShingo: 40000, fhsaContributedToDateSarah: 40000,
    incomeShingo: 0, incomeSarah: 0, tfsaIncludesRefund: false,
    balancesAsOf,
    workingMonthsInRetirementYear: 6,
  });
}

describe("the graph runs on a real calendar from today to the retirement month", () => {
  const rows = schedule("2026-10-10");
  const points = accumulationTimeline({
    rows,
    today: { year: 2026, month: 9, balances: BAL },
    retirementYear: 2036,
    workingMonthsInRetirementYear: 6,
  });

  it("starts today and stops in July of the retirement year", () => {
    expect(monthLabel(points[0]!.month)).toBe("Oct 2026");
    expect(monthLabel(points[points.length - 1]!.month)).toBe("Jul 2036");
    expect(points[0]!.lif).toBe(100_000);
  });

  it("puts each year-end balance at 1 January of the next year", () => {
    expect(monthLabel(points[1]!.month)).toBe("Jan 2027");
    expect(points[1]!.lif).toBe(rows[0]!.endLira);
    expect(points[1]!.dollarsYear).toBe(2026); // same dollars as the table's 2026 row
  });

  it("spaces the half-year retirement row half a year after the one before", () => {
    // It was drawn a full year out, which made the line flatten at the end.
    const last = points[points.length - 1]!;
    const before = points[points.length - 2]!;
    expect(last.month - before.month).toBe(6);
    expect(last.dollarsYear).toBe(2036);
  });

  it("keeps the growth rate steady to the end when nothing else changes", () => {
    // $100,000 at 7%: the last six months grow at the same pace as the rest.
    const last = points[points.length - 1]!;
    const before = points[points.length - 2]!;
    expect(last.lif / before.lif).toBeCloseTo(Math.sqrt(1.07), 10);
  });
});

describe("axis labels", () => {
  it("labels both ends by month and keeps the years between clear of them", () => {
    const ticks = timelineTicks(2026 * 12 + 9, 2036 * 12 + 6);
    expect(ticks.map((t) => t.label)).toEqual(["Oct 2026", "2028", "2030", "2032", "2034", "Jul 2036"]);
  });

  it("copes with a single point", () => {
    expect(timelineTicks(2036 * 12, 2036 * 12).map((t) => t.label)).toEqual(["Jan 2036"]);
  });
});
