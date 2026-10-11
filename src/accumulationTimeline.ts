/**
 * Puts the accumulation schedule on a real calendar for the graph.
 *
 * The schedule's rows are labelled by calendar year, but they are balances on a
 * date: a full row ends on 31 December, and the retirement row ends when they
 * retire in July. Plotting every row at its year number spaced the last row --
 * only six months of saving -- a full year from the one before, so the line
 * looked like it flattened just before retirement. Here every point sits at the
 * month it describes, from today to the retirement month.
 *
 * Times are counted in whole months (year * 12 + month, January = 0) so there
 * is no floating-point drift in labels or comparisons.
 */
import type { AccumRow } from "./accumulation";
import type { AccountBalances } from "./planDefaults";

export type TimelinePoint = {
  /** Months since year 0: year * 12 + month (January = 0). */
  month: number;
  /**
   * Calendar year whose dollars the point is shown in for "today's dollars",
   * the same year the accumulation table uses for that balance, so the graph,
   * the table and the retirement total always agree.
   */
  dollarsYear: number;
  fhsa: number;
  rrsp: number;
  tfsa: number;
  lif: number;
  nonReg: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthLabel(month: number) {
  return `${MONTHS[((month % 12) + 12) % 12]} ${Math.floor(month / 12)}`;
}

export function accumulationTimeline(params: {
  rows: AccumRow[];
  /** Balances today, which is where the schedule starts. */
  today: { year: number; month: number; balances: AccountBalances };
  retirementYear: number;
  /** Months of the retirement year still worked (both retire in July: 6). */
  workingMonthsInRetirementYear: number;
}): TimelinePoint[] {
  const { rows, today, retirementYear, workingMonthsInRetirementYear } = params;
  if (rows.length === 0) return [];

  const b = today.balances;
  const points: TimelinePoint[] = [
    {
      month: today.year * 12 + today.month,
      dollarsYear: today.year,
      fhsa: b.fhsaShingo + b.fhsaSarah,
      rrsp: b.rrspShingo + b.rrspSarah,
      tfsa: b.tfsaShingo + b.tfsaSarah,
      lif: b.liraShingo,
      nonReg: b.nonRegistered,
    },
  ];

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;
    // A row's balance is at the start of the month after its last month:
    // 1 January of the next year, or the retirement month for the last row.
    const month = isLast
      ? retirementYear * 12 + workingMonthsInRetirementYear
      : (r.year + 1) * 12;
    points.push({
      month,
      dollarsYear: r.year,
      fhsa: r.endFhsaTotal,
      rrsp: r.endRrspTotal,
      tfsa: r.endTfsaTotal,
      lif: r.endLira,
      nonReg: r.endNonReg,
    });
  });

  return points;
}

/**
 * Axis labels: the first and last points by month ("Oct 2026", "Jul 2036"),
 * with years in between at 1 January, kept clear of the two end labels.
 */
export function timelineTicks(startMonth: number, endMonth: number) {
  const ticks: { month: number; label: string }[] = [{ month: startMonth, label: monthLabel(startMonth) }];
  if (endMonth <= startMonth) return ticks;

  const clearance = 9; // months -- an end label is about twice as wide as a year
  const spanYears = (endMonth - startMonth) / 12;
  const step = Math.max(1, Math.round(spanYears / 6));
  const firstYear = Math.ceil((startMonth + clearance) / 12);
  for (let y = firstYear; y * 12 <= endMonth - clearance; y += step) {
    ticks.push({ month: y * 12, label: String(y) });
  }

  ticks.push({ month: endMonth, label: monthLabel(endMonth) });
  return ticks;
}
