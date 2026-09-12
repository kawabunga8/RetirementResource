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
