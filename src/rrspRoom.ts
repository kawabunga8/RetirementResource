/**
 * New RRSP contribution room created on 1 January of `year`.
 *
 *   min(18% of earned income, that year's RRSP dollar limit) - pension adjustment
 *
 * The dollar limit is indexed to average wage growth; we approximate that with
 * the plan's inflation assumption. The pension adjustment matters a great deal
 * for members of a defined-benefit plan -- it typically consumes most of the 18%.
 */
export const RRSP_ROOM_RATE = 0.18;

export function newRrspRoomForYear(params: {
  year: number;
  earnedIncome: number;
  pensionAdjustment: number;
  rrspDollarLimit: number;
  rrspDollarLimitYear: number;
  annualInflation: number;
}) {
  const limit =
    Math.max(0, params.rrspDollarLimit) *
    Math.pow(
      1 + Math.max(0, params.annualInflation),
      Math.max(0, params.year - params.rrspDollarLimitYear)
    );
  const earned = Math.max(0, params.earnedIncome) * RRSP_ROOM_RATE;
  return Math.max(0, Math.min(earned, limit) - Math.max(0, params.pensionAdjustment));
}
