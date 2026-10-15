import { describe, expect, it } from "vitest";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, type NonRegIncomeMix } from "../planDefaults";
import { buildWithdrawalSchedule, type RetirementBalances } from "./engine";
import { acbAfterYear, gainOnWithdrawal, normalizeMix, yearInvestmentIncome } from "./nonRegIncome";
import { deferredGainsTax, lifetimeTax, terminalTax, totalEstimatedTax, unrealizedGainsAtEnd } from "./strategies";

const ZERO_MIX: NonRegIncomeMix = {
  interest: 0,
  foreignDividends: 0,
  eligibleDividends: 0,
  nonEligibleDividends: 0,
  realizedGains: 0,
};

describe("non-registered payouts", () => {
  const mix = normalizeMix({ interest: 0.01, foreignDividends: 0.005, eligibleDividends: 0.0075, realizedGains: 0.01 });

  it("pays each type as a share of the opening balance", () => {
    const inv = yearInvestmentIncome({ balance: 200_000, acb: 100_000, mix, yearFraction: 1 });
    expect(inv.interest).toBeCloseTo(3_000); // interest + foreign dividends
    expect(inv.eligibleDividends).toBeCloseTo(1_500);
    expect(inv.capitalGains).toBeCloseTo(2_000);
  });

  it("halves the payouts in the retirement year", () => {
    const inv = yearInvestmentIncome({ balance: 200_000, acb: 100_000, mix, yearFraction: 0.5 });
    expect(inv.interest).toBeCloseTo(1_500);
  });

  it("never realizes a gain that does not exist", () => {
    // Worth $200k, cost $199.5k: only $500 of gain to realize.
    expect(yearInvestmentIncome({ balance: 200_000, acb: 199_500, mix, yearFraction: 1 }).capitalGains).toBeCloseTo(500);
    expect(yearInvestmentIncome({ balance: 200_000, acb: 250_000, mix, yearFraction: 1 }).capitalGains).toBe(0);
  });

  it("adds reinvested payouts and deposits to the cost base", () => {
    expect(acbAfterYear({ acb: 100_000, balanceStart: 150_000, reinvestedPayouts: 4_000, deposit: 10_000, withdrawal: 0 })).toBe(114_000);
  });

  it("removes a withdrawal's share of the cost base, and taxes only the gain part", () => {
    // Withdraw a third of a $150k account with a $100k cost base.
    expect(acbAfterYear({ acb: 100_000, balanceStart: 150_000, reinvestedPayouts: 0, deposit: 0, withdrawal: 50_000 })).toBeCloseTo(66_666.67, 1);
    expect(gainOnWithdrawal(50_000, 150_000, 100_000)).toBeCloseTo(16_666.67, 1);
  });

  it("fills missing or negative mix fields from the defaults / zero", () => {
    const m = normalizeMix({ interest: -1 } as Partial<NonRegIncomeMix>);
    expect(m.interest).toBe(0);
    expect(m.eligibleDividends).toBeGreaterThan(0);
  });
});

describe("engine: itemized non-registered tax", () => {
  const baseVars = {
    ...DEFAULT_VARIABLES,
    expectedInflation: 0,
    retirementNominalReturn: 0.05,
    retirementYear: 2036,
    phaseAges: { goGoEndAge: 72, slowGoEndAge: 72, endAge: 72 },
  };
  const balances: RetirementBalances = { fhsa: 0, rrsp: 400_000, tfsa: 0, lira: 0, nonRegistered: 300_000 };
  const run = (overrides: Partial<typeof baseVars>) =>
    buildWithdrawalSchedule({
      vars: { ...baseVars, ...overrides },
      anchors: DEFAULT_ANCHORS,
      retirementYear: 2036,
      retirementBalances: { ...balances },
      tfsaRoomAtRetirement: 0,
    });

  it("drag mode is the default and reports no investment income", () => {
    const rows = run({});
    expect(rows[1]!.debug.nonRegTaxMode).toBe("drag");
    expect(rows[1]!.investmentIncome.shingo.interest).toBe(0);
  });

  it("with an empty mix, itemized grows the account at the full return and taxes nothing extra", () => {
    const drag0 = run({ nonRegTaxDragRate: 0 });
    const itemized0 = run({ nonRegTaxMode: "itemized", nonRegIncomeMix: ZERO_MIX });
    expect(itemized0.map((r) => r.debug.tax)).toEqual(drag0.map((r) => r.debug.tax));
    expect(itemized0.at(-1)!.endBalances.nonRegistered).toBeCloseTo(drag0.at(-1)!.endBalances.nonRegistered, 2);
  });

  it("puts the payouts in both returns, splits them evenly, and covers the tax from the RRIF", () => {
    const empty = run({ nonRegTaxMode: "itemized", nonRegIncomeMix: ZERO_MIX });
    const paid = run({ nonRegTaxMode: "itemized" }); // balanced-ETF defaults
    const r = paid[1]!;
    // 1% interest + 0.75% foreign on the opening balance, halved between them.
    const opening = paid[0]!.endBalances.nonRegistered;
    expect(r.investmentIncome.shingo.interest).toBeCloseTo((opening * 0.0175) / 2, 2);
    expect(r.investmentIncome.sarah.eligibleDividends).toBeCloseTo((opening * 0.0075) / 2, 2);
    // More tax, so more RRIF drawn to keep spending on target...
    expect(r.debug.tax).toBeGreaterThan(empty[1]!.debug.tax);
    expect(r.withdrawals.rrsp).toBeGreaterThan(empty[1]!.withdrawals.rrsp);
    // ...and the account itself is not charged the tax: it earns the full 5% on
    // what is in it (opening balance plus the year's surplus deposit). A year
    // with a surplus deposits a little less, because the tax came out of it.
    expect(r.endBalances.nonRegistered).toBeCloseTo(
      (r.debug.startBalances.nonRegistered + r.surplusInvestedToNonReg) * 1.05,
      2
    );
    // Grossed-up dividends and half the gains show up in total income.
    expect(r.debug.taxableIncomeShingo).toBeGreaterThan(empty[1]!.debug.taxableIncomeShingo);
  });

  it("tracks the cost base: reinvested payouts and deposits raise it, unrealized growth does not", () => {
    const rows = run({ nonRegTaxMode: "itemized" });
    for (const r of rows) {
      expect(r.debug.endNonRegAcb).toBeLessThanOrEqual(r.endBalances.nonRegistered + 1e-6);
      const realized = r.investmentIncome.shingo.capitalGains + r.investmentIncome.sarah.capitalGains;
      expect(realized).toBeLessThanOrEqual(Math.max(0, r.debug.startBalances.nonRegistered - 0) + 1e-6);
    }
    expect(rows.at(-1)!.debug.endNonRegAcb).toBeGreaterThan(balances.nonRegistered);
  });
});

describe("strategy totals count the end-of-plan gains estimate", () => {
  const vars = {
    ...DEFAULT_VARIABLES,
    expectedInflation: 0,
    retirementNominalReturn: 0.05,
    retirementYear: 2036,
    phaseAges: { goGoEndAge: 72, slowGoEndAge: 72, endAge: 72 },
  };
  const rowsFor = (mode: "drag" | "itemized") =>
    buildWithdrawalSchedule({
      vars: { ...vars, nonRegTaxMode: mode },
      anchors: DEFAULT_ANCHORS,
      retirementYear: 2036,
      retirementBalances: { fhsa: 0, rrsp: 400_000, tfsa: 0, lira: 0, nonRegistered: 300_000 },
      tfsaRoomAtRetirement: 0,
    });

  it("is zero in the growth-trim approximation, which leaves no deferred gain", () => {
    const rows = rowsFor("drag");
    expect(unrealizedGainsAtEnd(rows)).toBe(0);
    expect(totalEstimatedTax(rows)).toBeCloseTo(lifetimeTax(rows) + terminalTax(rows), 6);
  });

  it("taxes half the unrealized gain at the terminal rate when itemized", () => {
    const rows = rowsFor("itemized");
    const gain = unrealizedGainsAtEnd(rows);
    expect(gain).toBeGreaterThan(0);
    expect(deferredGainsTax(rows)).toBeCloseTo(gain * 0.5 * 0.45, 6);
    expect(totalEstimatedTax(rows)).toBeCloseTo(lifetimeTax(rows) + terminalTax(rows) + deferredGainsTax(rows), 6);
  });
});
