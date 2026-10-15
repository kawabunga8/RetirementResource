import { DEFAULT_NON_REG_INCOME_MIX, type NonRegIncomeMix } from "../planDefaults";

/**
 * Itemized tax on the non-registered account (nonRegTaxMode "itemized").
 *
 * Each year the account pays out the plan's income mix as a share of its
 * opening balance. Those payouts are part of the return -- the balance still
 * grows at the full return, because they are reinvested -- but each type is
 * taxed under its own rules in that year's return. Price growth is taxed only
 * when it is realized; the cost base (ACB) is tracked so that a realized gain
 * can never exceed the gain that actually exists.
 *
 * The figures are CASH amounts. The tax engine applies the dividend gross-ups
 * and the capital-gains inclusion rate.
 */

/** One year's taxable payouts from the account, cash amounts. */
export type InvestmentIncome = {
  /** Interest plus foreign dividends -- both fully taxable. */
  interest: number;
  eligibleDividends: number;
  nonEligibleDividends: number;
  /** Realized gains, full amount (half is taxable). */
  capitalGains: number;
};

export const NO_INVESTMENT_INCOME: InvestmentIncome = {
  interest: 0,
  eligibleDividends: 0,
  nonEligibleDividends: 0,
  capitalGains: 0,
};

/**
 * Shingo's share of the account's income. It is a joint account (no
 * member_id), so its income is split evenly. Strictly, CRA attributes joint-
 * account income to whoever contributed the money; the surplus that funds it
 * comes from household cash, so an even split is the reasonable planning
 * assumption.
 */
export const NON_REG_SHARE_SHINGO = 0.5;

const rate = (x: number | undefined) => (Number.isFinite(x) ? Math.max(0, x as number) : 0);

/** The plan's mix with every field present and non-negative. */
export function normalizeMix(mix?: Partial<NonRegIncomeMix>): NonRegIncomeMix {
  const m = { ...DEFAULT_NON_REG_INCOME_MIX, ...(mix ?? {}) };
  return {
    interest: rate(m.interest),
    foreignDividends: rate(m.foreignDividends),
    eligibleDividends: rate(m.eligibleDividends),
    nonEligibleDividends: rate(m.nonEligibleDividends),
    realizedGains: rate(m.realizedGains),
  };
}

/**
 * The year's payouts from an account worth `balance` with cost base `acb`.
 * `yearFraction` is 0.5 in the retirement year, when the money arrives in July.
 * Realized gains are capped at the unrealized gain on hand: a fund cannot
 * distribute a gain it has not made.
 */
export function yearInvestmentIncome(params: {
  balance: number;
  acb: number;
  mix: NonRegIncomeMix;
  yearFraction: number;
}): InvestmentIncome {
  const b = Math.max(0, params.balance) * Math.max(0, params.yearFraction);
  const unrealized = Math.max(0, params.balance - params.acb);
  return {
    interest: b * (params.mix.interest + params.mix.foreignDividends),
    eligibleDividends: b * params.mix.eligibleDividends,
    nonEligibleDividends: b * params.mix.nonEligibleDividends,
    capitalGains: Math.min(unrealized, b * params.mix.realizedGains),
  };
}

export function scaleIncome(inv: InvestmentIncome, share: number): InvestmentIncome {
  return {
    interest: inv.interest * share,
    eligibleDividends: inv.eligibleDividends * share,
    nonEligibleDividends: inv.nonEligibleDividends * share,
    capitalGains: inv.capitalGains * share,
  };
}

export function addIncome(a: InvestmentIncome, b: InvestmentIncome): InvestmentIncome {
  return {
    interest: a.interest + b.interest,
    eligibleDividends: a.eligibleDividends + b.eligibleDividends,
    nonEligibleDividends: a.nonEligibleDividends + b.nonEligibleDividends,
    capitalGains: a.capitalGains + b.capitalGains,
  };
}

/** Cash paid out by the account this year (all reinvested). */
export function payoutTotal(inv: InvestmentIncome) {
  return inv.interest + inv.eligibleDividends + inv.nonEligibleDividends + inv.capitalGains;
}

/**
 * Cost base at year end.
 * - Reinvested payouts were taxed, so they ADD to the cost base.
 * - New deposits (the after-tax surplus) add at cost.
 * - A withdrawal removes its proportional share of the cost base; the rest of
 *   it is the realized gain (see gainOnWithdrawal).
 */
export function acbAfterYear(params: {
  acb: number;
  balanceStart: number;
  reinvestedPayouts: number;
  deposit: number;
  withdrawal: number;
}) {
  const share = params.balanceStart > 0 ? Math.min(1, Math.max(0, params.withdrawal) / params.balanceStart) : 0;
  return Math.max(
    0,
    params.acb * (1 - share) + Math.max(0, params.reinvestedPayouts) + Math.max(0, params.deposit)
  );
}

/** The gain realized by withdrawing `withdrawal` from an account with this cost base. */
export function gainOnWithdrawal(withdrawal: number, balance: number, acb: number) {
  if (withdrawal <= 0 || balance <= 0) return 0;
  const gainFraction = Math.max(0, 1 - acb / balance);
  return Math.min(withdrawal, balance) * gainFraction;
}
