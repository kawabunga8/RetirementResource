/**
 * CPP / OAS start-age adjustments.
 *
 * Both benefits are actuarially adjusted for when you start them:
 *
 *   CPP  — base is age 65. Starting early costs 0.6%/month (-36% at age 60);
 *          starting late adds 0.7%/month (+42% at age 70). Range: 60-70.
 *   OAS  — base is age 65. Cannot start before 65. Deferring adds
 *          0.6%/month (+36% at age 70). Range: 65-70.
 *
 * The dollar figures stored in the plan are quoted at age 70 (see
 * `Anchors.cppShingoAt70Monthly` and the OAS-at-70 defaults), so we convert
 * "amount at 70" -> "amount at 65" -> "amount at the chosen start age".
 */

/** The age at which the plan's stored CPP/OAS dollar amounts are quoted. */
export const BENEFITS_QUOTED_AT_AGE = 70;

export const CPP_MIN_START_AGE = 60;
export const CPP_MAX_START_AGE = 70;
export const OAS_MIN_START_AGE = 65;
export const OAS_MAX_START_AGE = 70;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

/** CPP amount at `startAge` as a multiple of the age-65 amount. */
export function cppAdjustmentFactor(startAge: number) {
  const age = clamp(startAge, CPP_MIN_START_AGE, CPP_MAX_START_AGE);
  const months = (age - 65) * 12;
  return months < 0 ? 1 + months * 0.006 : 1 + months * 0.007;
}

/** OAS amount at `startAge` as a multiple of the age-65 amount. */
export function oasAdjustmentFactor(startAge: number) {
  const age = clamp(startAge, OAS_MIN_START_AGE, OAS_MAX_START_AGE);
  const months = (age - 65) * 12;
  return 1 + months * 0.006;
}

/**
 * Convert a CPP amount quoted at BENEFITS_QUOTED_AT_AGE into the amount
 * actually payable if the benefit starts at `startAge`.
 */
export function cppAmountForStartAge(quotedAmount: number, startAge: number) {
  const quotedFactor = cppAdjustmentFactor(BENEFITS_QUOTED_AT_AGE);
  if (quotedFactor <= 0) return quotedAmount;
  return Math.max(0, quotedAmount) * (cppAdjustmentFactor(startAge) / quotedFactor);
}

/** As `cppAmountForStartAge`, for OAS. */
export function oasAmountForStartAge(quotedAmount: number, startAge: number) {
  const quotedFactor = oasAdjustmentFactor(BENEFITS_QUOTED_AT_AGE);
  if (quotedFactor <= 0) return quotedAmount;
  return Math.max(0, quotedAmount) * (oasAdjustmentFactor(startAge) / quotedFactor);
}

/** Effective start ages, clamped to what the programs actually allow. */
export function effectiveCppStartAge(startAge: number) {
  return clamp(startAge, CPP_MIN_START_AGE, CPP_MAX_START_AGE);
}

export function effectiveOasStartAge(startAge: number) {
  return clamp(startAge, OAS_MIN_START_AGE, OAS_MAX_START_AGE);
}
