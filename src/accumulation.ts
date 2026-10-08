/**
 * Working-years accumulation: how the accounts grow from today to retirement.
 *
 * Lives outside App.tsx so the Overview, the Current tab's future-year snapshot
 * and the tests all run the SAME loop. The Current tab used to carry its own
 * copy of this loop; the copy fell behind (no refunds, no RRSP overflow, no
 * start date) and disagreed with the Overview by ~$66,000 in 2036.
 */
import type { AccountBalances } from "./planDefaults";
import { tfsaLimitForYear } from "./tfsaRoom";
import { computeHouseholdTax } from "./tax/v2";
import { newRrspRoomForYear } from "./rrspRoom";
import { incomeGrowthFactor } from "./incomeGrowth";

// (local progressiveTax removed: all tax now goes through the v2 engine)

/**
 * Combined federal + BC tax on employment income for a single person, using the
 * SAME v2 engine (and the same year-indexed tables) as the rest of the model.
 *
 * This previously used a hardcoded copy of the 2024 brackets, which meant the
 * projected RRSP refund was computed at stale rates including the old 15%
 * bottom rate (now 14%).
 */
function estimateTaxBCCanada(income: number, taxYear: number, annualInflation: number) {
  const none = {
    employment: 0, pensionDb: 0, rrspWithdrawal: 0, rrifWithdrawal: 0,
    lifWithdrawal: 0, cpp: 0, oas: 0, tfsaWithdrawal: 0,
  };
  const res = computeHouseholdTax({
    taxYear,
    annualInflation,
    // Working-age single filer: BPA only, no age amount, no pension credit.
    spouseA: { name: "person", age: 45, incomes: { ...none, employment: Math.max(0, income) } },
    spouseB: { name: "unused", age: 45, incomes: { ...none } },
    credits: { useBpa: true, useAgeAmount: false, usePensionCredit: false },
    pensionSplitting: { enabled: false, optimize: false, step: 100 },
  });
  return res.spouseA.totalTax;
}

function estimateTaxSavingsFromDeduction(params: {
  income: number;
  deduction: number;
  taxYear: number;
  annualInflation: number;
}) {
  const deduction = Math.max(0, params.deduction);
  if (deduction <= 0) return 0;

  const before = estimateTaxBCCanada(params.income, params.taxYear, params.annualInflation);
  const after = estimateTaxBCCanada(
    Math.max(0, params.income - deduction),
    params.taxYear,
    params.annualInflation
  );
  return Math.max(0, before - after);
}

export function calculateBalancesToDate(params: {
  baselineYear: number;
  baselineBalances: AccountBalances;
  targetDateStr: string;
  annualReturn: number;
  fhsaContributedToDateShingo: number;
  fhsaContributedToDateSarah: number;
  fhsaAnnualLimit: number;
  fhsaLifetimeCap: number;
  monthlyFhsaShingo: number;
  monthlyFhsaSarah: number;
  monthlyRrspShingo: number;
  monthlyRrspSarah: number;
  monthlyTfsaTotal: number;
  nonRegTaxDragRate: number;
}): AccountBalances {
  const targetDate = new Date(params.targetDateStr + "T00:00:00");
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth();

  const monthsElapsed = Math.max(
    0,
    (targetYear - params.baselineYear) * 12 + targetMonth
  );

  const r = monthlyRateFromAnnual(params.annualReturn);
  const rNonReg = monthlyRateFromAnnual(
    params.annualReturn - Math.max(0, params.nonRegTaxDragRate)
  );

  let fhsaS = params.baselineBalances.fhsaShingo;
  let fhsaSa = params.baselineBalances.fhsaSarah;
  let rrspS = params.baselineBalances.rrspShingo;
  let rrspSa = params.baselineBalances.rrspSarah;
  let tfsaS = params.baselineBalances.tfsaShingo;
  let tfsaSa = params.baselineBalances.tfsaSarah;
  let lira = params.baselineBalances.liraShingo;
  let nonReg = params.baselineBalances.nonRegistered;

  let roomFhsaS = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateShingo);
  let roomFhsaSa = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateSarah);

  let fhsaAnnualUsedS = 0;
  let fhsaAnnualUsedSa = 0;

  for (let m = 0; m < monthsElapsed; m++) {
    if (m % 12 === 0) {
      fhsaAnnualUsedS = 0;
      fhsaAnnualUsedSa = 0;
    }

    const tfsaEach = params.monthlyTfsaTotal / 2;

    let rrspContribS = params.monthlyRrspShingo;
    let rrspContribSa = params.monthlyRrspSarah;

    let fhsaContribS = params.monthlyFhsaShingo;
    fhsaContribS = Math.min(fhsaContribS, Math.max(0, params.fhsaAnnualLimit - fhsaAnnualUsedS));
    fhsaContribS = Math.min(fhsaContribS, roomFhsaS);
    const overflowS = params.monthlyFhsaShingo - fhsaContribS;
    if (overflowS > 0) rrspContribS += overflowS;

    let fhsaContribSa = params.monthlyFhsaSarah;
    fhsaContribSa = Math.min(fhsaContribSa, Math.max(0, params.fhsaAnnualLimit - fhsaAnnualUsedSa));
    fhsaContribSa = Math.min(fhsaContribSa, roomFhsaSa);
    const overflowSa = params.monthlyFhsaSarah - fhsaContribSa;
    if (overflowSa > 0) rrspContribSa += overflowSa;

    fhsaS += fhsaContribS;
    fhsaSa += fhsaContribSa;
    rrspS += rrspContribS;
    rrspSa += rrspContribSa;
    tfsaS += tfsaEach;
    tfsaSa += tfsaEach;

    fhsaAnnualUsedS += fhsaContribS;
    fhsaAnnualUsedSa += fhsaContribSa;
    roomFhsaS -= fhsaContribS;
    roomFhsaSa -= fhsaContribSa;

    fhsaS *= 1 + r;
    fhsaSa *= 1 + r;
    rrspS *= 1 + r;
    rrspSa *= 1 + r;
    tfsaS *= 1 + r;
    tfsaSa *= 1 + r;
    lira *= 1 + r;
    // Non-registered growth is taxable as it is earned, so it compounds at a
    // reduced rate. Registered accounts are unaffected.
    nonReg *= 1 + rNonReg;
  }

  return {
    fhsaShingo: fhsaS,
    fhsaSarah: fhsaSa,
    rrspShingo: rrspS,
    rrspSarah: rrspSa,
    tfsaShingo: tfsaS,
    tfsaSarah: tfsaSa,
    liraShingo: lira,
    nonRegistered: nonReg,
  };
}

/** Per-person balances and contribution room at one moment in the projection. */
export type AccumPosition = {
  balances: AccountBalances;
  room: {
    tfsaShingo: number;
    tfsaSarah: number;
    rrspShingo: number;
    rrspSarah: number;
    fhsaShingo: number;
    fhsaSarah: number;
  };
};

export type AccumRow = {
  year: number;
  /** Months of this calendar year the row covers (partial at either end). */
  months: number;
  fhsaContribShingo: number;
  fhsaContribSarah: number;
  rrspContribShingo: number;
  rrspContribSarah: number;
  tfsaContribTotal: number;
  estRefundToTfsa: number;
  endFhsaTotal: number;
  endRrspTotal: number;
  endTfsaTotal: number;
  endLira: number;
  endNonReg: number;
  endTotal: number;
  /**
   * 1 January of this year, after that year's new TFSA and RRSP room has been
   * added and before any contributions. Absent for a first row that starts
   * part-way through the year.
   */
  startOfYear?: AccumPosition;
  /** End of the row's last month. */
  end: AccumPosition;
};

/**
 * Monthly rate that compounds to `annual` over twelve months.
 *
 * annual / 12 compounds to more than the stated rate: 7% becomes 7.23%, which
 * overstates every balance by a little more each year.
 */
export function monthlyRateFromAnnual(annual: number) {
  return Math.pow(1 + Math.max(-1, annual), 1 / 12) - 1;
}

export function buildAccumulationSchedule(params: {
  baselineYear: number;
  retirementYear: number;
  annualReturn: number;
  // starting balances
  fhsaShingo: number;
  fhsaSarah: number;
  rrspShingo: number;
  rrspSarah: number;
  tfsaShingo: number;
  tfsaSarah: number;
  liraShingo: number;
  nonRegistered: number;
  // starting contribution room
  tfsaRoomShingo: number;
  tfsaRoomSarah: number;
  rrspRoomShingo: number;
  rrspRoomSarah: number;
  // working income assumptions for new RRSP room
  earnedIncomeShingo: number;
  earnedIncomeSarah: number;
  earnedIncomeYear: number;
  // annual raise in working years (earned income, PA and working income)
  incomeGrowthRate: number;
  // RRSP annual dollar limit (indexed forward) and pension adjustments
  rrspDollarLimit: number;
  rrspDollarLimitYear: number;
  pensionAdjustmentShingo: number;
  pensionAdjustmentSarah: number;
  // inflation, used to index the RRSP dollar limit and TFSA limit forward
  annualInflation: number;
  // annual tax drag applied to non-registered growth
  nonRegTaxDragRate: number;
  // contributions
  monthlyFhsaShingo: number;
  monthlyFhsaSarah: number;
  monthlyRrspShingo: number;
  monthlyRrspSarah: number;
  monthlyTfsaTotal: number;
  // FHSA caps
  fhsaAnnualLimit: number;
  fhsaLifetimeCap: number;
  fhsaContributedToDateShingo: number;
  fhsaContributedToDateSarah: number;
  // Refund is always projected into TFSA, except for the balancesAsOf year
  // when tfsaIncludesRefund is true (balance already contains that deposit).
  incomeShingo: number;
  incomeSarah: number;
  tfsaIncludesRefund: boolean;
  // ISO date (YYYY-MM-DD): simulation starts from this month, skipping months
  // already reflected in the starting balances. Defaults to Jan 1 of baselineYear.
  balancesAsOf?: string;
  /**
   * Months of the retirement year still worked and saved from (both retire in
   * July: 6). Without them, contributions stopped at 31 December of the year
   * BEFORE retirement and six months of saving went missing.
   */
  workingMonthsInRetirementYear?: number;
}): AccumRow[] {
  const years = Math.max(0, params.retirementYear - params.baselineYear);
  const workingMonthsInRetirementYear = Math.max(
    0,
    Math.min(12, Math.round(params.workingMonthsInRetirementYear ?? 0))
  );
  const totalMonths = years * 12 + workingMonthsInRetirementYear;

  // Months from Jan 1 of baselineYear to balancesAsOf (already in the balance snapshot).
  const startMonth = (() => {
    if (!params.balancesAsOf) return 0;
    const d = new Date(params.balancesAsOf + "T00:00:00");
    const elapsed = (d.getFullYear() - params.baselineYear) * 12 + d.getMonth();
    return Math.max(0, Math.min(totalMonths, elapsed));
  })();

  // Year in which the balance snapshot was taken — refund suppressed for this year only.
  const balancesAsOfYear = params.balancesAsOf
    ? new Date(params.balancesAsOf + "T00:00:00").getFullYear()
    : params.baselineYear;

  const r = monthlyRateFromAnnual(params.annualReturn);
  // Non-registered growth is taxable as it is earned, so it compounds at a
  // reduced rate. Registered accounts are unaffected.
  const rNonReg = monthlyRateFromAnnual(
    params.annualReturn - Math.max(0, params.nonRegTaxDragRate)
  );

  // balances
  let fhsaS = params.fhsaShingo;
  let fhsaSa = params.fhsaSarah;
  let rrspS = params.rrspShingo;
  let rrspSa = params.rrspSarah;
  let tfsaS = params.tfsaShingo;
  let tfsaSa = params.tfsaSarah;
  let lira = params.liraShingo;
  let nonReg = params.nonRegistered;

  // contribution room trackers
  let tfsaRoomS = Math.max(0, params.tfsaRoomShingo);
  let tfsaRoomSa = Math.max(0, params.tfsaRoomSarah);
  let rrspRoomS = Math.max(0, params.rrspRoomShingo);
  let rrspRoomSa = Math.max(0, params.rrspRoomSarah);

  // FHSA remaining contribution room (lifetime) from facts
  let roomFhsaS = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateShingo);
  let roomFhsaSa = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateSarah);

  const position = (): AccumPosition => ({
    balances: {
      fhsaShingo: fhsaS,
      fhsaSarah: fhsaSa,
      rrspShingo: rrspS,
      rrspSarah: rrspSa,
      tfsaShingo: tfsaS,
      tfsaSarah: tfsaSa,
      liraShingo: lira,
      nonRegistered: nonReg,
    },
    room: {
      tfsaShingo: tfsaRoomS,
      tfsaSarah: tfsaRoomSa,
      rrspShingo: rrspRoomS,
      rrspSarah: rrspRoomSa,
      fhsaShingo: roomFhsaS,
      fhsaSarah: roomFhsaSa,
    },
  });

  // annual tracking (per calendar year)
  let fhsaAnnualUsedS = 0;
  let fhsaAnnualUsedSa = 0;
  let rrspAnnualS = 0;
  let rrspAnnualSa = 0;
  let tfsaAnnualActual = 0;
  let monthsThisYear = 0;
  let startOfYear: AccumPosition | undefined;

  const rows: AccumRow[] = [];

  for (let absMonth = startMonth; absMonth < totalMonths; absMonth++) {
    const yearIndex = Math.floor(absMonth / 12);
    const year = params.baselineYear + yearIndex;
    const monthInYear = absMonth % 12;

    // reset annual used at Jan
    if (monthInYear === 0) {
      fhsaAnnualUsedS = 0;
      fhsaAnnualUsedSa = 0;
      rrspAnnualS = 0;
      rrspAnnualSa = 0;
      tfsaAnnualActual = 0;

      // TFSA room increases each Jan 1 (excluding baseline snapshot year, since room is already provided as-of baseline).
      if (year > params.baselineYear) {
        const add = tfsaLimitForYear(year, params.annualInflation);
        tfsaRoomS += add;
        tfsaRoomSa += add;
      }

      // RRSP room increases each Jan 1. The real formula is
      //   min(18% of prior-year earned income, the RRSP dollar limit)
      //     minus last year's pension adjustment.
      // The dollar limit is indexed to average wage growth; we approximate that
      // with the plan's inflation assumption.
      if (year > params.baselineYear) {
        const common = {
          year,
          rrspDollarLimit: params.rrspDollarLimit,
          rrspDollarLimitYear: params.rrspDollarLimitYear,
          annualInflation: params.annualInflation,
          incomeAsOfYear: params.earnedIncomeYear,
          incomeGrowthRate: params.incomeGrowthRate,
        };
        rrspRoomS += newRrspRoomForYear({
          ...common,
          earnedIncome: params.earnedIncomeShingo,
          pensionAdjustment: params.pensionAdjustmentShingo,
        });
        rrspRoomSa += newRrspRoomForYear({
          ...common,
          earnedIncome: params.earnedIncomeSarah,
          pensionAdjustment: params.pensionAdjustmentSarah,
        });
      }

      startOfYear = position();
    }
    monthsThisYear += 1;

    // planned TFSA split
    const tfsaEachPlanned = params.monthlyTfsaTotal / 2;

    // planned RRSP
    let rrspContribS = params.monthlyRrspShingo;
    let rrspContribSa = params.monthlyRrspSarah;

    // FHSA Shingo with caps; overflow -> RRSP (same person)
    let fhsaContribS = params.monthlyFhsaShingo;
    fhsaContribS = Math.min(fhsaContribS, Math.max(0, params.fhsaAnnualLimit - fhsaAnnualUsedS));
    fhsaContribS = Math.min(fhsaContribS, roomFhsaS);
    const overflowS = params.monthlyFhsaShingo - fhsaContribS;
    if (overflowS > 0) rrspContribS += overflowS;

    // FHSA Sarah with caps; overflow -> RRSP (same person)
    let fhsaContribSa = params.monthlyFhsaSarah;
    fhsaContribSa = Math.min(
      fhsaContribSa,
      Math.max(0, params.fhsaAnnualLimit - fhsaAnnualUsedSa)
    );
    fhsaContribSa = Math.min(fhsaContribSa, roomFhsaSa);
    const overflowSa = params.monthlyFhsaSarah - fhsaContribSa;
    if (overflowSa > 0) rrspContribSa += overflowSa;

    // Enforce RRSP room. Anything that will not fit carries on down the chain
    // rather than disappearing: FHSA -> RRSP -> TFSA -> non-registered.
    //
    // This used to stop here ("contributions pause"), which meant a person
    // whose RRSP room ran out simply stopped saving in the model. Sarah's
    // pension adjustment exhausts her room in 2033, so the plan showed her
    // contributing nothing at all for the last two and a half years before
    // retirement -- about $37,200 of intended saving deleted rather than
    // redirected. Nobody stops saving because a registered account is full.
    const rrspSAllowed = Math.min(rrspContribS, rrspRoomS);
    const rrspSaAllowed = Math.min(rrspContribSa, rrspRoomSa);
    const overflowToTfsaS = rrspContribS - rrspSAllowed;
    const overflowToTfsaSa = rrspContribSa - rrspSaAllowed;
    rrspContribS = rrspSAllowed;
    rrspContribSa = rrspSaAllowed;

    // Apply contributions (FHSA + RRSP)
    fhsaS += fhsaContribS;
    fhsaSa += fhsaContribSa;
    rrspS += rrspContribS;
    rrspSa += rrspContribSa;
    rrspAnnualS += rrspContribS;
    rrspAnnualSa += rrspContribSa;

    rrspRoomS -= rrspContribS;
    rrspRoomSa -= rrspContribSa;

    // TFSA contributions: the planned amount plus whatever the RRSP could not
    // take, still capped by each person's own TFSA room.
    const tfsaWantedS = tfsaEachPlanned + overflowToTfsaS;
    const tfsaWantedSa = tfsaEachPlanned + overflowToTfsaSa;
    const tfsaSAllowed = Math.min(tfsaWantedS, tfsaRoomS);
    const tfsaSaAllowed = Math.min(tfsaWantedSa, tfsaRoomSa);

    tfsaS += tfsaSAllowed;
    tfsaSa += tfsaSaAllowed;

    tfsaRoomS -= tfsaSAllowed;
    tfsaRoomSa -= tfsaSaAllowed;
    tfsaAnnualActual += tfsaSAllowed + tfsaSaAllowed;

    // Last stop. Non-registered has no contribution limit, so nothing is lost.
    // It grows at the drag-reduced rate below, which is the honest cost of
    // having run out of shelter.
    nonReg += (tfsaWantedS - tfsaSAllowed) + (tfsaWantedSa - tfsaSaAllowed);

    // update cap trackers
    fhsaAnnualUsedS += fhsaContribS;
    fhsaAnnualUsedSa += fhsaContribSa;
    roomFhsaS -= fhsaContribS;
    roomFhsaSa -= fhsaContribSa;

    // growth
    fhsaS *= 1 + r;
    fhsaSa *= 1 + r;
    rrspS *= 1 + r;
    rrspSa *= 1 + r;
    tfsaS *= 1 + r;
    tfsaSa *= 1 + r;
    lira *= 1 + r;
    nonReg *= 1 + rNonReg;

    // record a row at the end of each calendar year, and at the end of the
    // last simulated month (the retirement year stops part-way through)
    const endOfRow = monthInYear === 11 || absMonth === totalMonths - 1;
    if (endOfRow) {
      // Estimate annual refund from RRSP+FHSA deductions and deposit into TFSA once per year.
      const fhsaAnnualS = fhsaAnnualUsedS;
      const fhsaAnnualSa = fhsaAnnualUsedSa;

      const suppressRefund = params.tfsaIncludesRefund && year === balancesAsOfYear;
      // Working income is a baseline-year figure; this year's pay includes the
      // raises since. In the retirement year only the months worked are paid.
      const raise = incomeGrowthFactor({
        asOfYear: params.baselineYear,
        year,
        growthRate: params.incomeGrowthRate,
      });
      const paidShare = year === params.retirementYear ? workingMonthsInRetirementYear / 12 : 1;
      const estRefundToTfsa = !suppressRefund
        ? estimateTaxSavingsFromDeduction({
            income: params.incomeShingo * raise * paidShare,
            deduction: rrspAnnualS + fhsaAnnualS,
            taxYear: year,
            annualInflation: params.annualInflation,
          }) +
          estimateTaxSavingsFromDeduction({
            income: params.incomeSarah * raise * paidShare,
            deduction: rrspAnnualSa + fhsaAnnualSa,
            taxYear: year,
            annualInflation: params.annualInflation,
          })
        : 0;

      // Deposit refund into TFSA (split 50/50) but respect TFSA room. Whatever
      // will not fit goes to non-registered, like every other overflow.
      if (estRefundToTfsa > 0) {
        const each = estRefundToTfsa / 2;
        const addS = Math.min(each, tfsaRoomS);
        const addSa = Math.min(each, tfsaRoomSa);
        tfsaS += addS;
        tfsaSa += addSa;
        tfsaRoomS -= addS;
        tfsaRoomSa -= addSa;
        nonReg += estRefundToTfsa - addS - addSa;
      }

      const endFhsaTotal = fhsaS + fhsaSa;
      const endRrspTotal = rrspS + rrspSa;
      const endTfsaTotal = tfsaS + tfsaSa;
      const endNonReg = nonReg;
      const endTotal = endFhsaTotal + endRrspTotal + endTfsaTotal + lira + endNonReg;

      rows.push({
        year,
        months: monthsThisYear,
        fhsaContribShingo: fhsaAnnualUsedS,
        fhsaContribSarah: fhsaAnnualUsedSa,
        rrspContribShingo: rrspAnnualS,
        rrspContribSarah: rrspAnnualSa,
        tfsaContribTotal: tfsaAnnualActual,
        estRefundToTfsa,
        endFhsaTotal,
        endRrspTotal,
        endTfsaTotal,
        endLira: lira,
        endNonReg,
        endTotal,
        startOfYear,
        end: position(),
      });
      monthsThisYear = 0;
      startOfYear = undefined;
    }
  }

  return rows;
}
