/**
 * Working income is assumed to rise each year until retirement.
 *
 * Returns the multiplier that takes an income figure dated `asOfYear` to
 * `year`. Years before the figure are left alone rather than discounted: the
 * figure is a fact, not a projection to be run backwards.
 */
export function incomeGrowthFactor(params: {
  asOfYear: number;
  year: number;
  growthRate: number;
}) {
  return Math.pow(1 + params.growthRate, Math.max(0, params.year - params.asOfYear));
}

/** Years of salary a final-average-earnings DB pension is based on. */
export const PENSION_AVERAGE_YEARS = 5;

/**
 * How much salary raises lift a pension quoted on a no-raise statement.
 *
 * A pension statement projects today's salary unchanged to retirement. A
 * final-average plan pays in proportion to the average salary over the last
 * PENSION_AVERAGE_YEARS working years, so raises lift the pension by exactly as
 * much as they lift that average.
 */
export function pensionRaiseFactor(params: {
  statementYear: number;
  retirementYear: number;
  growthRate: number;
}) {
  let sum = 0;
  for (let k = 1; k <= PENSION_AVERAGE_YEARS; k++) {
    sum += incomeGrowthFactor({
      asOfYear: params.statementYear,
      year: params.retirementYear - k,
      growthRate: params.growthRate,
    });
  }
  return sum / PENSION_AVERAGE_YEARS;
}
