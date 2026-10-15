import type { AccountBalances } from "../planDefaults";

/**
 * Who owns the pooled registered accounts.
 *
 * The withdrawal engine draws the RRSP/RRIF and the FHSA as one household pot
 * each, but RRSPs and FHSAs are registered per person and tax is assessed per
 * person. These are Shingo's fractions of each pot; Sarah's is 1 minus it.
 *
 * Because every withdrawal comes out of the pot in the same proportion and both
 * halves grow at the same rate, the fraction stays fixed from retirement on --
 * until one pot is merged into the other (the FHSA rollover), which re-weights it.
 *
 * Before this existed the engine taxed RRIF income 50/50 and the Tax tab split
 * it by TODAY's balances -- two different answers, and neither the projected one.
 */
export type Ownership = {
  rrspShingo: number;
  fhsaShingo: number;
};

/** The old assumption, kept as the fallback when no projection is supplied. */
export const EVEN_OWNERSHIP: Ownership = { rrspShingo: 0.5, fhsaShingo: 0.5 };

function share(shingo: number, sarah: number) {
  const a = Math.max(0, shingo);
  const b = Math.max(0, sarah);
  return a + b > 0 ? a / (a + b) : 0.5;
}

/** Ownership from per-person balances -- pass the accumulation's retirement-day balances. */
export function ownershipFromBalances(
  b: Pick<AccountBalances, "rrspShingo" | "rrspSarah" | "fhsaShingo" | "fhsaSarah">
): Ownership {
  return {
    rrspShingo: share(b.rrspShingo, b.rrspSarah),
    fhsaShingo: share(b.fhsaShingo, b.fhsaSarah),
  };
}

/** Shingo's share of the RRSP pot after the FHSA pot is rolled into it. */
export function shareAfterFhsaRollover(
  rrspBalance: number,
  rrspShareShingo: number,
  fhsaBalance: number,
  fhsaShareShingo: number
) {
  const total = Math.max(0, rrspBalance) + Math.max(0, fhsaBalance);
  if (total <= 0) return rrspShareShingo;
  return (Math.max(0, rrspBalance) * rrspShareShingo + Math.max(0, fhsaBalance) * fhsaShareShingo) / total;
}

/**
 * The most a pooled withdrawal can be before EITHER spouse passes their
 * taxable-income headroom, when income cannot be moved between them (no
 * pension splitting). Shingo receives `shareShingo` of every dollar.
 *
 * At an even split this is 2 x the smaller headroom, which is what the engine
 * hard-coded before.
 */
export function pooledCapWithoutSplitting(
  headroomShingo: number,
  headroomSarah: number,
  shareShingo: number
) {
  const capShingo = shareShingo > 0 ? Math.max(0, headroomShingo) / shareShingo : Infinity;
  const capSarah = shareShingo < 1 ? Math.max(0, headroomSarah) / (1 - shareShingo) : Infinity;
  return Math.min(capShingo, capSarah);
}
