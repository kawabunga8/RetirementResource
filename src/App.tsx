import { useMemo, useState } from "react";
import "./App.css";
import {
  DEFAULT_ANCHORS,
  DEFAULT_VARIABLES,
  type AccountBalances,
  type MonthlyContributions,
  type Variables,
  type WithdrawalOrder,
  type LifMode,
} from "./planDefaults";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const lines = label.split("\n");
  return (
    <label style={{ display: "grid", gap: 6, justifyItems: "start" }}>
      <div style={{ fontSize: 12, opacity: 0.8, lineHeight: 1.15 }}>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      {children}
    </label>
  );
}

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  // Round UP to the nearest dollar
  const rounded = Math.ceil(n);
  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}

function sumBalances(b: AccountBalances) {
  return (
    b.fhsaShingo +
    b.fhsaSarah +
    b.rrspShingo +
    b.rrspSarah +
    b.tfsaShingo +
    b.tfsaSarah +
    b.liraShingo +
    b.nonRegistered
  );
}

function sumMonthly(m: MonthlyContributions) {
  return m.tfsaTotal + m.fhsaShingo + m.fhsaSarah + m.rrspShingo + m.rrspSarah;
}

function futureValueMonthly({
  pv,
  monthlyContribution,
  annualReturn,
  months,
}: {
  pv: number;
  monthlyContribution: number;
  annualReturn: number;
  months: number;
}) {
  const r = annualReturn / 12;
  if (months <= 0) return pv;
  if (Math.abs(r) < 1e-9) return pv + monthlyContribution * months;

  // FV = PV*(1+r)^n + PMT * ((1+r)^n - 1) / r
  const growth = Math.pow(1 + r, months);
  return pv * growth + monthlyContribution * ((growth - 1) / r);
}

// (removed unused helper)

type AccumRow = {
  year: number;
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
  endTotal: number;
};

function buildAccumulationSchedule(params: {
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
  // Refund modeling
  incomeShingo: number;
  incomeSarah: number;
  enableRefundToTfsa: boolean;
}): AccumRow[] {
  const years = Math.max(0, params.retirementYear - params.baselineYear);
  const months = years * 12;
  const r = params.annualReturn / 12;

  // balances
  let fhsaS = params.fhsaShingo;
  let fhsaSa = params.fhsaSarah;
  let rrspS = params.rrspShingo;
  let rrspSa = params.rrspSarah;
  let tfsaS = params.tfsaShingo;
  let tfsaSa = params.tfsaSarah;
  let lira = params.liraShingo;

  // FHSA remaining contribution room (lifetime) from facts
  let roomFhsaS = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateShingo);
  let roomFhsaSa = Math.max(0, params.fhsaLifetimeCap - params.fhsaContributedToDateSarah);

  // annual tracking (per calendar year)
  let fhsaAnnualUsedS = 0;
  let fhsaAnnualUsedSa = 0;
  let rrspAnnualS = 0;
  let rrspAnnualSa = 0;

  const rows: AccumRow[] = [];

  for (let m = 0; m < months; m++) {
    const yearIndex = Math.floor(m / 12);
    const year = params.baselineYear + yearIndex;

    // reset annual used at Jan
    if (m % 12 === 0) {
      fhsaAnnualUsedS = 0;
      fhsaAnnualUsedSa = 0;
      rrspAnnualS = 0;
      rrspAnnualSa = 0;
    }

    // planned TFSA split
    const tfsaEach = params.monthlyTfsaTotal / 2;

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

    // apply contributions
    fhsaS += fhsaContribS;
    fhsaSa += fhsaContribSa;
    rrspS += rrspContribS;
    rrspSa += rrspContribSa;
    rrspAnnualS += rrspContribS;
    rrspAnnualSa += rrspContribSa;
    tfsaS += tfsaEach;
    tfsaSa += tfsaEach;

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

    // record end-of-year snapshot
    const endOfYear = (m % 12) === 11;
    if (endOfYear) {
      // Estimate annual refund from RRSP+FHSA deductions and deposit into TFSA once per year.
      // (v1: uses the simple tax estimator; no credits.)
      const fhsaAnnualS = fhsaAnnualUsedS;
      const fhsaAnnualSa = fhsaAnnualUsedSa;
      const tfsaAnnual = params.monthlyTfsaTotal * 12;

      const estRefundToTfsa = params.enableRefundToTfsa
        ? estimateTaxSavingsFromDeduction({
            income: params.incomeShingo,
            deduction: rrspAnnualS + fhsaAnnualS,
          }) +
          estimateTaxSavingsFromDeduction({
            income: params.incomeSarah,
            deduction: rrspAnnualSa + fhsaAnnualSa,
          })
        : 0;

      // Deposit refund into TFSA (split 50/50 for now)
      if (estRefundToTfsa > 0) {
        tfsaS += estRefundToTfsa / 2;
        tfsaSa += estRefundToTfsa / 2;
      }

      const endFhsaTotal = fhsaS + fhsaSa;
      const endRrspTotal = rrspS + rrspSa;
      const endTfsaTotal = tfsaS + tfsaSa;
      const endTotal = endFhsaTotal + endRrspTotal + endTfsaTotal + lira;

      rows.push({
        year,
        fhsaContribShingo: fhsaAnnualUsedS,
        fhsaContribSarah: fhsaAnnualUsedSa,
        rrspContribShingo: rrspAnnualS,
        rrspContribSarah: rrspAnnualSa,
        tfsaContribTotal: tfsaAnnual,
        estRefundToTfsa,
        endFhsaTotal,
        endRrspTotal,
        endTfsaTotal,
        endLira: lira,
        endTotal,
      });
    }
  }

  return rows;
}

function toRealDollars(nominal: number, annualInflation: number, years: number) {
  if (years <= 0) return nominal;
  const d = Math.pow(1 + annualInflation, years);
  if (!Number.isFinite(d) || d === 0) return nominal;
  return nominal / d;
}

type RetirementBalances = {
  fhsa: number;
  rrsp: number;
  tfsa: number;
  lira: number;
  nonRegistered: number;
};

function clampToZero(n: number) {
  return n < 0 ? 0 : n;
}

function withdrawFrom(
  amount: number,
  balance: number,
  cap: number
): { withdrawn: number; remainingNeed: number; newBalance: number } {
  if (amount <= 0) return { withdrawn: 0, remainingNeed: 0, newBalance: balance };

  const allowed = cap > 0 ? Math.min(amount, cap) : amount;
  const withdrawn = Math.min(allowed, balance);
  return {
    withdrawn,
    remainingNeed: amount - withdrawn,
    newBalance: balance - withdrawn,
  };
}

function rrifMinFactor(age: number) {
  // Canada RRIF minimum factors:
  // - age <= 70: 1 / (90 - age)
  // - age >= 71: prescribed table
  if (age <= 0) return 0;
  if (age <= 70) return 1 / (90 - age);

  const table: Record<number, number> = {
    71: 0.0528,
    72: 0.054,
    73: 0.0553,
    74: 0.0567,
    75: 0.0582,
    76: 0.0598,
    77: 0.0617,
    78: 0.0636,
    79: 0.0658,
    80: 0.0682,
    81: 0.0708,
    82: 0.0738,
    83: 0.0771,
    84: 0.0808,
    85: 0.0851,
    86: 0.0899,
    87: 0.0955,
    88: 0.1021,
    89: 0.1099,
    90: 0.1192,
    91: 0.1306,
    92: 0.1449,
    93: 0.1634,
    94: 0.1879,
    95: 0.2,
  };

  if (age >= 95) return 0.2;
  return table[age] ?? (1 / (90 - 70));
}

function lifFactorApprox(age: number, mode: LifMode) {
  // NOTE: This is a simplified approximation to support the UI right now.
  // Min is modeled as RRIF minimum factor; Max is modeled as ~2x min (capped at 20%).
  const minF = rrifMinFactor(age);
  const maxF = Math.min(0.2, minF * 2);
  if (mode === "min") return minF;
  if (mode === "max") return maxF;
  return (minF + maxF) / 2;
}

function progressiveTax(income: number, brackets: Array<{ upTo: number; rate: number }>) {
  // brackets are ascending, last bracket should have upTo = Infinity
  let remaining = Math.max(0, income);
  let lastCap = 0;
  let tax = 0;

  for (const b of brackets) {
    const cap = b.upTo;
    const width = cap === Infinity ? remaining : Math.max(0, Math.min(remaining, cap - lastCap));
    tax += width * b.rate;
    remaining -= width;
    lastCap = cap === Infinity ? lastCap : cap;
    if (remaining <= 0) break;
  }

  return tax;
}

function estimateFederalTaxCanada(income: number) {
  // Approximate current-style brackets; excludes BPA/credits/surtaxes.
  return progressiveTax(income, [
    { upTo: 55867, rate: 0.15 },
    { upTo: 111733, rate: 0.205 },
    { upTo: 173205, rate: 0.26 },
    { upTo: 246752, rate: 0.29 },
    { upTo: Infinity, rate: 0.33 },
  ]);
}

function estimateBCTax(income: number) {
  // Approximate BC brackets; excludes BC credits.
  return progressiveTax(income, [
    { upTo: 45654, rate: 0.0506 },
    { upTo: 91310, rate: 0.077 },
    { upTo: 104835, rate: 0.105 },
    { upTo: 127299, rate: 0.1229 },
    { upTo: 172602, rate: 0.147 },
    { upTo: 240716, rate: 0.168 },
    { upTo: Infinity, rate: 0.205 },
  ]);
}

function estimateTaxBCCanada(income: number) {
  return estimateFederalTaxCanada(income) + estimateBCTax(income);
}

function estimateTaxSavingsFromDeduction(params: {
  income: number;
  deduction: number;
}) {
  const deduction = Math.max(0, params.deduction);
  if (deduction <= 0) return 0;

  const before = estimateTaxBCCanada(params.income);
  const after = estimateTaxBCCanada(Math.max(0, params.income - deduction));
  return Math.max(0, before - after);
}

export default function App() {
  const [vars, setVars] = useState<Variables>(DEFAULT_VARIABLES);
  const [page, setPage] = useState<"overview" | "tax" | "withdrawals">("overview");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [wideLayout, setWideLayout] = useState(false);

  // navigation uses page tabs now

  const pensionAnnual =
    DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const baselineTotal = useMemo(() => sumBalances(vars.balances), [vars.balances]);
  const monthlyTotal = useMemo(() => sumMonthly(vars.monthly), [vars.monthly]);

  const model = useMemo(() => {
    const yearsToRetirement =
      DEFAULT_ANCHORS.targetRetirementYear - DEFAULT_ANCHORS.baselineYear;
    const monthsToRetirement = Math.max(0, Math.round(yearsToRetirement * 12));

    const accumulationSchedule = buildAccumulationSchedule({
      baselineYear: DEFAULT_ANCHORS.baselineYear,
      retirementYear: DEFAULT_ANCHORS.targetRetirementYear,
      annualReturn: vars.expectedNominalReturn,
      fhsaShingo: vars.balances.fhsaShingo,
      fhsaSarah: vars.balances.fhsaSarah,
      rrspShingo: vars.balances.rrspShingo,
      rrspSarah: vars.balances.rrspSarah,
      tfsaShingo: vars.balances.tfsaShingo,
      tfsaSarah: vars.balances.tfsaSarah,
      liraShingo: vars.balances.liraShingo,
      monthlyFhsaShingo: vars.monthly.fhsaShingo,
      monthlyFhsaSarah: vars.monthly.fhsaSarah,
      monthlyRrspShingo: vars.monthly.rrspShingo,
      monthlyRrspSarah: vars.monthly.rrspSarah,
      monthlyTfsaTotal: vars.monthly.tfsaTotal,
      fhsaAnnualLimit: vars.fhsa.annualLimit,
      fhsaLifetimeCap: vars.fhsa.lifetimeCap,
      fhsaContributedToDateShingo: vars.fhsa.contributedShingo,
      fhsaContributedToDateSarah: vars.fhsa.contributedSarah,
      incomeShingo: vars.tax.shingoIncome,
      incomeSarah: vars.tax.sarahIncome,
      enableRefundToTfsa: vars.tax.enableRefundToTfsa,
    });

    const lastAccum = accumulationSchedule[accumulationSchedule.length - 1];

    const nonRegisteredAtRetirement = futureValueMonthly({
      pv: vars.balances.nonRegistered,
      monthlyContribution: 0,
      annualReturn: vars.expectedNominalReturn,
      months: monthsToRetirement,
    });

    let retirementBalances: RetirementBalances = {
      fhsa: lastAccum?.endFhsaTotal ?? 0,
      rrsp: lastAccum?.endRrspTotal ?? 0,
      tfsa: lastAccum?.endTfsaTotal ?? 0,
      lira: lastAccum?.endLira ?? 0,
      nonRegistered: nonRegisteredAtRetirement,
    };

    // Optional: roll FHSA into RRSP at retirement (common if not used for a home purchase).
    if (vars.withdrawals.rollFhsaIntoRrspAtRetirement) {
      retirementBalances = {
        ...retirementBalances,
        rrsp: retirementBalances.rrsp + retirementBalances.fhsa,
        fhsa: 0,
      };
    }

    const totalNominalAtRetirement =
      retirementBalances.fhsa +
      retirementBalances.rrsp +
      retirementBalances.tfsa +
      retirementBalances.lira +
      retirementBalances.nonRegistered;

    const totalRealAtRetirement = toRealDollars(
      totalNominalAtRetirement,
      vars.expectedInflation,
      yearsToRetirement
    );

    // --- Withdrawal schedule (simple v1) ---
    const retireYear = DEFAULT_ANCHORS.targetRetirementYear;
    const retireAgeShingo = vars.shingoRetireAge;
    const retireAgeSarah = vars.sarahRetireAge;

    const yearsInPlan = Math.max(0, vars.phaseAges.endAge - Math.min(retireAgeShingo, retireAgeSarah) + 1);

    const rows: Array<{
      year: number;
      ageShingo: number;
      ageSarah: number;
      phase: "Go-Go" | "Slow-Go" | "No-Go";
      targetSpending: number;
      guaranteedIncome: number;
      benefitsIncome: number;
      spendingGap: number;
      withdrawals: Record<string, number>;
      forcedLif: number;
      forcedRrif: number;
      surplusInvestedToTfsa: number;
      surplusInvestedToNonReg: number;
      endBalances: RetirementBalances;
    }> = [];

    let balances: RetirementBalances = { ...retirementBalances };
    let tfsaRoom = Math.max(0, vars.withdrawals.tfsaRoomAtRetirement);

    for (let i = 0; i < yearsInPlan; i++) {
      const year = retireYear + i;

      // Each year in retirement, new TFSA room is created (simple model).
      tfsaRoom += Math.max(0, vars.withdrawals.tfsaNewRoomPerYear);

      const ageShingo = retireAgeShingo + i;
      const ageSarah = retireAgeSarah + i;

      const phase: "Go-Go" | "Slow-Go" | "No-Go" =
        ageShingo <= vars.phaseAges.goGoEndAge ? "Go-Go" : ageShingo <= vars.phaseAges.slowGoEndAge ? "Slow-Go" : "No-Go";

      const targetSpending =
        phase === "Go-Go"
          ? vars.spending.goGo
          : phase === "Slow-Go"
            ? vars.spending.slowGo
            : vars.spending.noGo;

      const guaranteedIncome = pensionAnnual;

      const benefitsIncome =
        (ageShingo >= vars.cppStartAge ? vars.withdrawals.cppShingoAnnual : 0) +
        (ageSarah >= vars.cppStartAge ? vars.withdrawals.cppSarahAnnual : 0) +
        (ageShingo >= vars.oasStartAge ? vars.withdrawals.oasShingoAnnual : 0) +
        (ageSarah >= vars.oasStartAge ? vars.withdrawals.oasSarahAnnual : 0);

      let spendingGap = clampToZero(targetSpending - guaranteedIncome - benefitsIncome);

      const withdrawals: Record<string, number> = {
        fhsa: 0,
        rrsp: 0,
        lira: 0,
        nonRegistered: 0,
        tfsa: 0,
      };

      // 1) Fund the spending gap from accounts, using the chosen priority order.
      for (const src of vars.withdrawals.order) {
        if (spendingGap <= 0) break;

        if (src === "tfsa" && !vars.withdrawals.allowTfsa) continue;
        if (src === "pension") continue;

        if (src === "fhsa") {
          const r = withdrawFrom(
            spendingGap,
            balances.fhsa,
            vars.withdrawals.caps.fhsa
          );
          withdrawals.fhsa += r.withdrawn;
          balances.fhsa = r.newBalance;
          spendingGap = r.remainingNeed;
        } else if (src === "rrsp") {
          const r = withdrawFrom(
            spendingGap,
            balances.rrsp,
            vars.withdrawals.caps.rrsp
          );
          withdrawals.rrsp += r.withdrawn;
          balances.rrsp = r.newBalance;
          spendingGap = r.remainingNeed;
        } else if (src === "lira") {
          // LIF cap: use BC mode (min/mid/max). If user entered an explicit cap,
          // we apply the tighter (smaller) of the two.
          const lifCap =
            balances.lira * lifFactorApprox(ageShingo, vars.withdrawals.lifMode);
          const explicitCap = vars.withdrawals.caps.lira;
          const cap = explicitCap > 0 ? Math.min(explicitCap, lifCap) : lifCap;

          const r = withdrawFrom(spendingGap, balances.lira, cap);
          withdrawals.lira += r.withdrawn;
          balances.lira = r.newBalance;
          spendingGap = r.remainingNeed;
        } else if (src === "nonRegistered") {
          const r = withdrawFrom(
            spendingGap,
            balances.nonRegistered,
            vars.withdrawals.caps.nonRegistered
          );
          withdrawals.nonRegistered += r.withdrawn;
          balances.nonRegistered = r.newBalance;
          spendingGap = r.remainingNeed;
        } else if (src === "tfsa") {
          const r = withdrawFrom(
            spendingGap,
            balances.tfsa,
            vars.withdrawals.caps.tfsa
          );
          withdrawals.tfsa += r.withdrawn;
          balances.tfsa = r.newBalance;
          spendingGap = r.remainingNeed;
        }
      }

      // 2) Force LIF withdrawals starting at retirement (if enabled).
      // This is independent of spending needs; it can create surplus.
      let forcedLif = 0;
      if (vars.withdrawals.forceLifFromRetirement && balances.lira > 0) {
        const lifCap = balances.lira * lifFactorApprox(ageShingo, vars.withdrawals.lifMode);
        const explicitCap = vars.withdrawals.caps.lira;
        const cap = explicitCap > 0 ? Math.min(explicitCap, lifCap) : lifCap;

        const r = withdrawFrom(cap, balances.lira, cap);
        forcedLif = r.withdrawn;
        withdrawals.lira += r.withdrawn;
        balances.lira = r.newBalance;
      }

      // 3) Hard-force RRSP/RRIF withdrawal to hit the depletion target age.
      // Simple approach: amortize remaining RRSP balance over remaining years.
      let forcedRrif = 0;
      if (ageShingo <= vars.withdrawals.rrifDepleteByAge && balances.rrsp > 0) {
        const yearsLeft = Math.max(1, vars.withdrawals.rrifDepleteByAge - ageShingo + 1);
        const requiredThisYear = balances.rrsp / yearsLeft;
        const extraNeeded = Math.max(0, requiredThisYear - withdrawals.rrsp);

        const r = withdrawFrom(extraNeeded, balances.rrsp, 0);
        forcedRrif = r.withdrawn;
        withdrawals.rrsp += r.withdrawn;
        balances.rrsp = r.newBalance;
      }

      // 4) Any surplus (because we forced withdrawals) is invested into TFSA.
      const totalWithdrawals =
        withdrawals.fhsa +
        withdrawals.rrsp +
        withdrawals.lira +
        withdrawals.nonRegistered +
        withdrawals.tfsa;

      const cashIn = guaranteedIncome + benefitsIncome + totalWithdrawals;
      const surplus = clampToZero(cashIn - targetSpending);

      // Route surplus: TFSA until room is exhausted, then to non-registered.
      const toTfsa = Math.min(surplus, tfsaRoom);
      const toNonReg = surplus - toTfsa;
      balances.tfsa += toTfsa;
      balances.nonRegistered += toNonReg;
      tfsaRoom -= toTfsa;

      const surplusInvestedToTfsa = toTfsa;
      const surplusInvestedToNonReg = toNonReg;

      // Apply growth at year-end to remaining balances (very simplified)
      balances = {
        fhsa: balances.fhsa * (1 + vars.expectedNominalReturn),
        rrsp: balances.rrsp * (1 + vars.expectedNominalReturn),
        tfsa: balances.tfsa * (1 + vars.expectedNominalReturn),
        lira: balances.lira * (1 + vars.expectedNominalReturn),
        nonRegistered: balances.nonRegistered * (1 + vars.expectedNominalReturn),
      };

      rows.push({
        year,
        ageShingo,
        ageSarah,
        phase,
        targetSpending,
        guaranteedIncome,
        benefitsIncome,
        spendingGap,
        withdrawals,
        forcedLif,
        forcedRrif,
        surplusInvestedToTfsa,
        surplusInvestedToNonReg,
        endBalances: { ...balances },
      });
    }

    return {
      yearsToRetirement,
      monthsToRetirement,
      baselineTotal,
      monthlyTotal,
      accumulationSchedule,
      retirementBalances,
      totalNominalAtRetirement,
      totalRealAtRetirement,
      schedule: rows,
    };
  }, [vars, pensionAnnual, baselineTotal, monthlyTotal]);

  const orderOptions: WithdrawalOrder[] = [
    "fhsa",
    "rrsp",
    "lira",
    "nonRegistered",
    "tfsa",
  ];

  return (
    <div
      className={wideLayout ? "app wide" : "app"}
      style={{
        width: "100%",
        // Wide layout should still fit within the viewport; only tables should scroll.
        maxWidth: wideLayout ? 1200 : 1080,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>RetirementResource</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>
          A retirement planning calculator (Canada / BC). Adjust levers (timing,
          contributions, return assumptions, spending phases) while keeping
          anchors explicit.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setVars(DEFAULT_VARIABLES)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "white",
              cursor: "pointer",
            }}
            title="Reset all inputs back to the starting snapshot and default assumptions"
          >
            Reset to starting values
          </button>
          <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "center" }}>
            Tip: if you’re viewing on Vercel, hard refresh after deploy so the
            newest defaults load.
          </div>
        </div>
      </header>

      <nav
        className="card"
        style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <strong style={{ marginRight: 8 }}>Pages:</strong>
          <button
            type="button"
            className="linkBtn"
            onClick={() => setPage("overview")}
            aria-current={page === "overview"}
          >
            Overview
          </button>
          <button
            type="button"
            className="linkBtn"
            onClick={() => setPage("tax")}
            aria-current={page === "tax"}
          >
            Tax
          </button>
          <button
            type="button"
            className="linkBtn"
            onClick={() => setPage("withdrawals")}
            aria-current={page === "withdrawals"}
          >
            Withdrawals
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, opacity: 0.85 }}>
            <input
              type="checkbox"
              checked={wideLayout}
              onChange={(e) => setWideLayout(e.target.checked)}
            />
            Wide-screen layout
          </label>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {page === "overview" ? "Edit assumptions + see balances at retirement" : null}
            {page === "tax" ? "Rough BC+federal tax bracket estimate" : null}
            {page === "withdrawals" ? "Drawdown order, caps, and the schedule" : null}
          </div>
        </div>
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {page === "overview" && (
        <>
        <section id="expectations" className="card">
          <h2>Expectations (adjustable)</h2>
          <div className="selectRow">
            <Field label="Expected nominal return (e.g. 0.07 = 7%)">
              <input
                type="number"
                step="0.001"
                value={vars.expectedNominalReturn}
                style={{ maxWidth: 90 }}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    expectedNominalReturn: num(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Expected inflation (e.g. 0.02 = 2%)">
              <input
                type="number"
                step="0.001"
                value={vars.expectedInflation}
                style={{ maxWidth: 90 }}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    expectedInflation: num(e.target.value),
                  }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>FHSA caps (facts / rules)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            FHSA contributions are capped at <strong>$8,000/year</strong> and <strong>$40,000 lifetime</strong> (per person).
            Growth does not count toward the contribution cap. When FHSA is capped, this model redirects
            that monthly amount into RRSP (same person).
          </p>

          <div className="tightGrid">
            <Field label="FHSA annual limit (per person, $/yr)">
              <input
                type="number"
                value={vars.fhsa.annualLimit}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    fhsa: { ...v.fhsa, annualLimit: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="FHSA lifetime cap (per person, $)">
              <input
                type="number"
                value={vars.fhsa.lifetimeCap}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    fhsa: { ...v.fhsa, lifetimeCap: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Shingo FHSA contributed (to date, $)">
              <input
                type="number"
                value={vars.fhsa.contributedShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    fhsa: { ...v.fhsa, contributedShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Sarah FHSA contributed (to date, $)">
              <input
                type="number"
                value={vars.fhsa.contributedSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    fhsa: { ...v.fhsa, contributedSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>

          <div style={{ marginTop: 10, fontSize: 13 }}>
            Remaining FHSA room (Shingo):{" "}
            <strong>${money(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo))}</strong>
            {" "} | Remaining FHSA room (Sarah):{" "}
            <strong>${money(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah))}</strong>
          </div>
        </section>

        <section id="retirement-balances" className="card">
          <h2>Starting balances at retirement (projected)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This is calculated by simulating contributions month-by-month from {DEFAULT_ANCHORS.baselineYear} to {DEFAULT_ANCHORS.targetRetirementYear},
            including FHSA annual/lifetime caps and redirecting any capped FHSA contribution into RRSP.
          </p>
          <ul>
            <li>
              FHSA (household): <strong>${money(model.retirementBalances.fhsa)}</strong>
            </li>
            <li>
              RRSP (household): <strong>${money(model.retirementBalances.rrsp)}</strong>
            </li>
            <li>
              TFSA (household): <strong>${money(model.retirementBalances.tfsa)}</strong>
            </li>
            <li>
              LIRA/LIF (Shingo): <strong>${money(model.retirementBalances.lira)}</strong>
            </li>
            <li>
              Non-registered: <strong>${money(model.retirementBalances.nonRegistered)}</strong>
            </li>
          </ul>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>
              Total (nominal): <strong>${money(model.totalNominalAtRetirement)}</strong>
            </div>
            <div style={{ fontSize: 13 }}>
              Total (in today’s dollars):{" "}
              <strong>${money(model.totalRealAtRetirement)}</strong>
            </div>
          </div>

          <h3 style={{ marginTop: 14 }}>Accumulation table (years leading up to retirement)</h3>
          <div className="scheduleWrap">
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    ["Year", ""],
                    ["Contrib", "FHSA S"],
                    ["Contrib", "FHSA Sa"],
                    ["Contrib", "RRSP S"],
                    ["Contrib", "RRSP Sa"],
                    ["Contrib", "TFSA HH"],
                    ["Refund→", "TFSA"],
                    ["End", "FHSA"],
                    ["End", "RRSP"],
                    ["End", "TFSA"],
                    ["End", "LIRA"],
                    ["End", "Total"],
                  ].map(([top, bottom]) => {
                    const key = `${top}-${bottom}`;
                    return (
                      <th
                        key={key}
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                          whiteSpace: "nowrap",
                          lineHeight: 1.1,
                        }}
                      >
                        <div>{top}</div>
                        {bottom ? <div style={{ fontSize: 11, opacity: 0.8 }}>{bottom}</div> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {model.accumulationSchedule.map((r) => (
                  <tr key={r.year}>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.year}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.fhsaContribShingo)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.fhsaContribSarah)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.rrspContribShingo)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.rrspContribSarah)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.tfsaContribTotal)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.estRefundToTfsa)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.endFhsaTotal)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.endRrspTotal)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.endTfsaTotal)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.endLira)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.endTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        </>
        )}

        {page === "tax" && (
        <section id="tax" className="card">
          <h2>Tax estimate (simple, BC + federal)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This is a rough estimator using progressive brackets and <strong>no credits</strong>
            (no BPA, age amount, pension credit, splitting, etc.). It’s useful for
            ballpark sensitivity, not exact filing.
          </p>

          <div className="selectRow">
            <Field label="Refund → TFSA">
              <select
                className="yesNoSelect"
                value={vars.tax.enableRefundToTfsa ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    tax: {
                      ...v.tax,
                      enableRefundToTfsa: e.target.value === "yes",
                    },
                  }))
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>

            <Field label="Shingo income ($/yr)">
              <input
                className="moneyInputLg"
                type="number"
                value={vars.tax.shingoIncome}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    tax: { ...v.tax, shingoIncome: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Sarah income ($/yr)">
              <input
                className="moneyInputLg"
                type="number"
                value={vars.tax.sarahIncome}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    tax: { ...v.tax, sarahIncome: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>

          {(() => {
            const taxShingo = estimateTaxBCCanada(vars.tax.shingoIncome);
            const taxSarah = estimateTaxBCCanada(vars.tax.sarahIncome);
            const netShingo = vars.tax.shingoIncome - taxShingo;
            const netSarah = vars.tax.sarahIncome - taxSarah;
            return (
              <ul style={{ marginTop: 10 }}>
                <li>
                  Shingo tax est.: <strong>${money(taxShingo)}</strong> | After-tax: <strong>${money(netShingo)}</strong>
                </li>
                <li>
                  Sarah tax est.: <strong>${money(taxSarah)}</strong> | After-tax: <strong>${money(netSarah)}</strong>
                </li>
                <li>
                  Household tax est.: <strong>${money(taxShingo + taxSarah)}</strong> | Household after-tax: <strong>${money(netShingo + netSarah)}</strong>
                </li>
              </ul>
            );
          })()}
        </section>
        )}

        {page === "withdrawals" && (
        <section id="withdrawals" className="card">
          <h2>Withdrawal schedule (simple v1)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This schedule is <strong>annual</strong> and <strong>pre-tax</strong>.
            Each year we calculate:
            <br />
            <strong>Spending gap to fund</strong> = Target spending − (Pensions + CPP/OAS),
            then withdraw from accounts in your chosen priority order (respecting
            any annual caps).
            <br />
            <strong>RRIF depletion (hard forced):</strong> we will also force extra RRSP/RRIF
            withdrawals (if needed) so the RRSP/RRIF balance reaches $0 by your
            chosen target age.
          </p>

          <h3 style={{ marginTop: 14 }}>Phases</h3>

          <div className="ageRow">
            <Field label="Go-Go ends at age">
              <input
                className="ageInput"
                type="number"
                value={vars.phaseAges.goGoEndAge}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    phaseAges: { ...v.phaseAges, goGoEndAge: num(e.target.value) },
                  }))
                }
              />
            </Field>

            <Field label="Slow-Go ends at age">
              <input
                className="ageInput"
                type="number"
                value={vars.phaseAges.slowGoEndAge}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    phaseAges: { ...v.phaseAges, slowGoEndAge: num(e.target.value) },
                  }))
                }
              />
            </Field>

            <Field label="Life expectancy / end age">
              <input
                className="ageInput"
                type="number"
                value={vars.phaseAges.endAge}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    phaseAges: { ...v.phaseAges, endAge: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>

          <div className="grid" style={{ marginTop: 10 }}>
            <Field label="Go-Go spending target (annual, $)">
              <input
                type="number"
                value={vars.spending.goGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, goGo: num(e.target.value) },
                  }))
                }
              />
            </Field>

            <Field label="Slow-Go spending target (annual, $)">
              <input
                type="number"
                value={vars.spending.slowGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, slowGo: num(e.target.value) },
                  }))
                }
              />
            </Field>

            <Field label="No-Go spending target (annual, $)">
              <input
                type="number"
                value={vars.spending.noGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, noGo: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Withdrawals (rules)</h3>
          <div className="selectRow">
            <Field label="Allow TFSA withdrawals">
              <select
                value={vars.withdrawals.allowTfsa ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: { ...v.withdrawals, allowTfsa: e.target.value === "yes" },
                  }))
                }
              >
                <option value="no">No (preserve TFSA unless forced)</option>
                <option value="yes">Yes</option>
              </select>
            </Field>

            <Field label="Drawdown priority #1">
              <select
                className="prioritySelect"
                value={vars.withdrawals.order[0]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => ({
                    ...s,
                    withdrawals: {
                      ...s.withdrawals,
                      order: [v, ...s.withdrawals.order.filter((x) => x !== v)],
                    },
                  }));
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #2">
              <select
                className="prioritySelect"
                value={vars.withdrawals.order[1]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const rest = s.withdrawals.order.filter((x) => x !== v);
                    const next = [rest[0], v, ...rest.slice(1)].filter(Boolean) as WithdrawalOrder[];
                    // Ensure uniqueness/preserve length
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #3">
              <select
                className="prioritySelect"
                value={vars.withdrawals.order[2]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], v, ...base.slice(2)];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #4">
              <select
                className="prioritySelect"
                value={vars.withdrawals.order[3]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], base[2], v, ...base.slice(3)];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #5">
              <select
                className="prioritySelect"
                value={vars.withdrawals.order[4]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], base[2], base[3], v];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Retirement account handling</h3>
          <div className="selectRow">
            <Field label="Roll FHSA into RRSP\n(at retirement)">
              <select
                className="yesNoSelect"
                value={vars.withdrawals.rollFhsaIntoRrspAtRetirement ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      rollFhsaIntoRrspAtRetirement: e.target.value === "yes",
                    },
                  }))
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>

            <Field label="TFSA room @ retirement (household, $)\n(used for surplus routing)">
              <input
                className="moneyInputLg"
                type="number"
                value={vars.withdrawals.tfsaRoomAtRetirement}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      tfsaRoomAtRetirement: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>

            <Field label="New TFSA room per year\n(household, $/yr)">
              <input
                className="moneyInputSm"
                type="number"
                value={vars.withdrawals.tfsaNewRoomPerYear}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      tfsaNewRoomPerYear: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>

            <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "end" }}>
              Surplus cash (e.g. from forced RRIF withdrawals) is invested into TFSA
              until this room is used up, then routed to Non-registered.
            </div>
          </div>

          <h3 style={{ marginTop: 14 }}>LIF withdrawal setting (BC)</h3>
          <div className="selectRow">
            <Field
              label={`LIF mode (current: ${
                vars.withdrawals.lifMode === "max"
                  ? "max"
                  : vars.withdrawals.lifMode === "mid"
                    ? "mid"
                    : "min"
              })`}
            >
              <select
                className="lifModeSelect"
                value={vars.withdrawals.lifMode}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      lifMode: e.target.value as LifMode,
                    },
                  }))
                }
              >
                <option value="max">max</option>
                <option value="mid">mid</option>
                <option value="min">min</option>
              </select>
            </Field>

            <Field label="Target RRIF depletion age">
              <input
                className="ageInput"
                type="number"
                value={vars.withdrawals.rrifDepleteByAge}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      rrifDepleteByAge: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>

            <Field label="Force LIF withdrawals\n(starting at retirement)">
              <select
                className="yesNoSelect"
                value={vars.withdrawals.forceLifFromRetirement ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      forceLifFromRetirement: e.target.value === "yes",
                    },
                  }))
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Field>

            <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "end" }}>
              If Yes, withdraw LIF each year starting at retirement using the selected
              LIF mode (min/mid/max). Surplus is invested TFSA→NonReg.
            </div>
          </div>

          <h3 style={{ marginTop: 14 }}>Withdrawal caps (annual, $; 0 = no cap)</h3>
          <div className="selectRow">
            <Field label="FHSA cap">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.caps.fhsa}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, fhsa: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="RRSP/RRIF cap">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.caps.rrsp}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, rrsp: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="LIRA/LIF cap">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.caps.lira}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, lira: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="Non-reg cap">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.caps.nonRegistered}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: {
                        ...v.withdrawals.caps,
                        nonRegistered: num(e.target.value),
                      },
                    },
                  }))
                }
              />
            </Field>
            <Field label="TFSA cap">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.caps.tfsa}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, tfsa: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Benefits (annual placeholders)</h3>
          <div className="selectRow">
            <Field label="CPP Shingo ($/yr)">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.cppShingoAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      cppShingoAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="CPP Sarah ($/yr)">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.cppSarahAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      cppSarahAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="OAS Shingo ($/yr)">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.oasShingoAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      oasShingoAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="OAS Sarah ($/yr)">
              <input
                className="moneyInputMd"
                type="number"
                value={vars.withdrawals.oasSarahAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      oasSarahAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Schedule</h3>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.85, marginTop: 6 }}>
            <input
              type="checkbox"
              checked={showFullSchedule}
              onChange={(e) => setShowFullSchedule(e.target.checked)}
            />
            Show full schedule (otherwise first 12 years)
          </label>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Note: Sarah’s CPP/OAS begins when <strong>she</strong> reaches the selected start age (e.g. 70),
            which is typically ~2 years after Shingo given your birth years.
          </div>
          <div className="scheduleWrap">
            <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    ["Year", ""],
                    ["Age", "Shingo"],
                    ["Age", "Sarah"],
                    ["Phase", ""],
                    ["Spend", "$/yr"],
                    ["Pension", "$/yr"],
                    ["CPP+OAS", "$/yr"],
                    ["Gap", "$/yr"],
                    ["W/d", "FHSA"],
                    ["W/d", "RRSP"],
                    ["W/d", "LIF"],
                    ["W/d", "NonReg"],
                    ["W/d", "TFSA"],
                    ["Forced", "LIF"],
                    ["Forced", "RRIF"],
                    ["Surplus→", "TFSA"],
                    ["Surplus→", "NonReg"],
                    ["End bal", "$"],
                  ].map(([top, bottom]) => {
                    const key = `${top}-${bottom}`;
                    return (
                      <th
                        key={key}
                        style={{
                          textAlign: "right",
                          padding: "6px 8px",
                          borderBottom: "1px solid #e5e7eb",
                          whiteSpace: "nowrap",
                          lineHeight: 1.1,
                        }}
                      >
                        <div>{top}</div>
                        {bottom ? <div style={{ fontSize: 11, opacity: 0.8 }}>{bottom}</div> : null}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(showFullSchedule ? model.schedule : model.schedule.slice(0, 12)).map((r) => {
                  const endTotal =
                    r.endBalances.fhsa +
                    r.endBalances.rrsp +
                    r.endBalances.lira +
                    r.endBalances.tfsa +
                    r.endBalances.nonRegistered;
                  return (
                    <tr key={r.year}>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.year}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.ageShingo}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.ageSarah}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.phase}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.targetSpending)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.guaranteedIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.benefitsIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.targetSpending - r.guaranteedIncome - r.benefitsIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.fhsa)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.rrsp)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.lira)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.nonRegistered)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.tfsa)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.forcedLif)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.forcedRrif)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.surplusInvestedToTfsa)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.surplusInvestedToNonReg)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(endTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>

      <footer style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        <div>
          Note: withdrawal schedule is pre-tax and simplified. Next step is to add
          RRIF/LIF rules + tax brackets.
        </div>
      </footer>
    </div>
  );
}
