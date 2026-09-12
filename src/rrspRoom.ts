/**
 * New RRSP contribution room created on 1 January of `year`.
 *
 *   min(18% of earned income, that year's RRSP dollar limit) - pension adjustment
 *
 * The dollar limit is indexed to average wage growth; we approximate that with
 * the plan's inflation assumption. The pension adjustment matters a great deal
 * for members of a defined-benefit plan -- it typically consumes most of the 18%.
 */
import { incomeGrowthFactor } from "./incomeGrowth";

export const RRSP_ROOM_RATE = 0.18;

export function newRrspRoomForYear(params: {
  year: number;
  earnedIncome: number;
  pensionAdjustment: number;
  rrspDollarLimit: number;
  rrspDollarLimitYear: number;
  annualInflation: number;
  /** Year earnedIncome and pensionAdjustment are from. Omit to use them as given. */
  incomeAsOfYear?: number;
  incomeGrowthRate?: number;
}) {
  const limit =
    Math.max(0, params.rrspDollarLimit) *
    Math.pow(
      1 + Math.max(0, params.annualInflation),
      Math.max(0, params.year - params.rrspDollarLimitYear)
    );
  // Room created on 1 January is earned on the PRIOR year's income. Income and
  // pension adjustment grow together: a DB plan's PA is a fixed share of
  // pensionable earnings, so raising one without the other overstates room.
  const growth =
    params.incomeAsOfYear == null
      ? 1
      : incomeGrowthFactor({
          asOfYear: params.incomeAsOfYear,
          year: params.year - 1,
          growthRate: params.incomeGrowthRate ?? 0,
        });
  const earned = Math.max(0, params.earnedIncome) * growth * RRSP_ROOM_RATE;
  return Math.max(0, Math.min(earned, limit) - Math.max(0, params.pensionAdjustment) * growth);
}
