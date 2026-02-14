import { useMemo, useRef, useState } from "react";
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
import { TFSA_ANNUAL_LIMIT_BY_YEAR } from "./data/publicRules";
import { computeHouseholdTax } from "./tax/v2";

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
  endNonReg: number;
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
  nonRegistered: number;
  // starting contribution room
  tfsaRoomShingo: number;
  tfsaRoomSarah: number;
  rrspRoomShingo: number;
  rrspRoomSarah: number;
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
  let nonReg = params.nonRegistered;

  // contribution room trackers
  let tfsaRoomS = Math.max(0, params.tfsaRoomShingo);
  let tfsaRoomSa = Math.max(0, params.tfsaRoomSarah);
  let rrspRoomS = Math.max(0, params.rrspRoomShingo);
  let rrspRoomSa = Math.max(0, params.rrspRoomSarah);

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

      // TFSA room increases each Jan 1 (excluding baseline snapshot year, since room is already provided as-of baseline).
      if (year > params.baselineYear) {
        const add = TFSA_ANNUAL_LIMIT_BY_YEAR[String(year) as keyof typeof TFSA_ANNUAL_LIMIT_BY_YEAR] ?? 0;
        tfsaRoomS += add;
        tfsaRoomSa += add;
      }
    }

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

    // Enforce RRSP room. If room is exhausted, contributions pause (no overflow routing).
    const rrspSAllowed = Math.min(rrspContribS, rrspRoomS);
    const rrspSaAllowed = Math.min(rrspContribSa, rrspRoomSa);
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

    // TFSA contributions (planned), capped by TFSA room. If room is exhausted, contributions pause.
    const tfsaSAllowed = Math.min(tfsaEachPlanned, tfsaRoomS);
    const tfsaSaAllowed = Math.min(tfsaEachPlanned, tfsaRoomSa);

    tfsaS += tfsaSAllowed;
    tfsaSa += tfsaSaAllowed;

    tfsaRoomS -= tfsaSAllowed;
    tfsaRoomSa -= tfsaSaAllowed;

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
    nonReg *= 1 + r;

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

      // Deposit refund into TFSA (split 50/50) but respect TFSA room.
      // If TFSA room is exhausted, the refund is not invested (paused) in this simplified model.
      if (estRefundToTfsa > 0) {
        const each = estRefundToTfsa / 2;
        const addS = Math.min(each, tfsaRoomS);
        const addSa = Math.min(each, tfsaRoomSa);
        tfsaS += addS;
        tfsaSa += addSa;
        tfsaRoomS -= addS;
        tfsaRoomSa -= addSa;
      }

      const endFhsaTotal = fhsaS + fhsaSa;
      const endRrspTotal = rrspS + rrspSa;
      const endTfsaTotal = tfsaS + tfsaSa;
      const endNonReg = nonReg;
      const endTotal = endFhsaTotal + endRrspTotal + endTfsaTotal + lira + endNonReg;

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
        endNonReg,
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

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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
  // Approximate current-style brackets; excludes credits/surtaxes.
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

// (v1 taxCreditsEstimate removed; v2 engine is in src/tax/v2.ts)

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
  const [page, setPage] = useState<"overview" | "current" | "tax" | "withdrawals">("overview");
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [wideLayout, setWideLayout] = useState(false);

  const adjustDollars = (amountNominal: number, year: number) => {
    if (vars.dollarsMode !== "real") return amountNominal;
    const yearsFromBaseline = year - DEFAULT_ANCHORS.baselineYear;
    return toRealDollars(amountNominal, vars.expectedInflation, yearsFromBaseline);
  };

  const moneyY = (amountNominal: number, year: number) => money(adjustDollars(amountNominal, year));

  const indexRate = vars.expectedInflation * vars.cpiMultiplier;
  const indexAmount = (baseAmountNominal: number, yearsFromStart: number) => {
    if (vars.dollarsMode === "real") return baseAmountNominal;
    return baseAmountNominal * Math.pow(1 + indexRate, Math.max(0, yearsFromStart));
  };

  const withdrawalTableRef = useRef<HTMLDivElement | null>(null);
  const accumulationTableRef = useRef<HTMLDivElement | null>(null);

  const getScrollEl = (key: "withdrawal" | "accumulation") => {
    const byId = document.getElementById(
      key === "withdrawal" ? "withdrawalScheduleWrap" : "accumulationScheduleWrap"
    ) as HTMLDivElement | null;

    if (byId) return byId;

    return document.querySelector(
      `[data-scrolltable="${key}"]`
    ) as HTMLDivElement | null;
  };

  const scrollTable = (
    ref: React.RefObject<HTMLDivElement | null>,
    key: "withdrawal" | "accumulation",
    action: "left" | "right" | "edge-left" | "edge-right"
  ) => {
    const el = ref.current ?? getScrollEl(key);
    if (!el) return;

    // iOS Safari: direct scrollLeft writes are most reliable.
    if (action === "edge-left") {
      el.scrollLeft = 0;
      return;
    }

    if (action === "edge-right") {
      el.scrollLeft = el.scrollWidth;
      return;
    }

    const dx = Math.max(200, Math.floor(el.clientWidth * 0.9));
    el.scrollLeft += action === "left" ? -dx : dx;
  };

  const makeScrollHandlers = (
    ref: React.RefObject<HTMLDivElement | null>,
    key: "withdrawal" | "accumulation",
    action: "left" | "right" | "edge-left" | "edge-right"
  ) => {
    const fn = () => scrollTable(ref, key, action);
    return {
      onClick: fn,
      onTouchEnd: (e: React.TouchEvent) => {
        e.preventDefault();
        fn();
      },
    };
  };

  // navigation uses page tabs now

  const pensionAnnual =
    DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const baselineTotal = useMemo(() => sumBalances(vars.balances), [vars.balances]);
  const monthlyTotal = useMemo(() => sumMonthly(vars.monthly), [vars.monthly]);

  const model = useMemo(() => {
    const yearsToRetirement = vars.retirementYear - DEFAULT_ANCHORS.baselineYear;
    const monthsToRetirement = Math.max(0, Math.round(yearsToRetirement * 12));

    const accumulationSchedule = buildAccumulationSchedule({
      baselineYear: DEFAULT_ANCHORS.baselineYear,
      retirementYear: vars.retirementYear,
      annualReturn: vars.expectedNominalReturn,
      fhsaShingo: vars.balances.fhsaShingo,
      fhsaSarah: vars.balances.fhsaSarah,
      rrspShingo: vars.balances.rrspShingo,
      rrspSarah: vars.balances.rrspSarah,
      tfsaShingo: vars.balances.tfsaShingo,
      tfsaSarah: vars.balances.tfsaSarah,
      liraShingo: vars.balances.liraShingo,
      nonRegistered: vars.balances.nonRegistered,
      tfsaRoomShingo: vars.tfsaRoomShingo,
      tfsaRoomSarah: vars.tfsaRoomSarah,
      rrspRoomShingo: vars.rrspRoomShingo,
      rrspRoomSarah: vars.rrspRoomSarah,
      monthlyFhsaShingo: vars.monthly.fhsaShingo,
      monthlyFhsaSarah: vars.monthly.fhsaSarah,
      monthlyRrspShingo: vars.monthly.rrspShingo,
      monthlyRrspSarah: vars.monthly.rrspSarah,
      monthlyTfsaTotal: vars.monthly.tfsaTotal,
      fhsaAnnualLimit: vars.fhsa.annualLimit,
      fhsaLifetimeCap: vars.fhsa.lifetimeCap,
      fhsaContributedToDateShingo: vars.fhsa.contributedShingo,
      fhsaContributedToDateSarah: vars.fhsa.contributedSarah,
      incomeShingo: vars.tax.workingIncomeShingo,
      incomeSarah: vars.tax.workingIncomeSarah,
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
    const retireYear = vars.retirementYear;
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
      tax: number;
      taxableIncomeShingo: number;
      taxableIncomeSarah: number;
      oasClawbackRiskShingo: boolean;
      oasClawbackRiskSarah: boolean;
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

      const yearsIntoRetirement = i;

      const guaranteedIncome =
        indexAmount(pensionAnnual, yearsIntoRetirement);

      const benefitsIncome =
        (ageShingo >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppShingoAnnual, yearsIntoRetirement) : 0) +
        (ageSarah >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppSarahAnnual, yearsIntoRetirement) : 0) +
        (ageShingo >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasShingoAnnual, yearsIntoRetirement) : 0) +
        (ageSarah >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasSarahAnnual, yearsIntoRetirement) : 0);

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
      // Optionally front-load withdrawals early in retirement.
      let forcedRrif = 0;
      if (ageShingo <= vars.withdrawals.rrifDepleteByAge && balances.rrsp > 0) {
        const yearsLeft = Math.max(1, vars.withdrawals.rrifDepleteByAge - ageShingo + 1);

        const f = clamp01(vars.withdrawals.rrifFrontLoad);
        const ratio = 1 + 4 * f; // 1..5 (higher = more front-loaded)

        // Weight this year more heavily than future years.
        // This creates a decreasing schedule that still fully depletes the remaining balance over yearsLeft.
        const sumWeights = ratio === 1 ? yearsLeft : (Math.pow(ratio, yearsLeft) - 1) / (ratio - 1);
        const w0 = Math.pow(ratio, yearsLeft - 1);
        const requiredThisYear = balances.rrsp * (w0 / sumWeights);

        const extraNeeded = Math.max(0, requiredThisYear - withdrawals.rrsp);

        const r = withdrawFrom(extraNeeded, balances.rrsp, 0);
        forcedRrif = r.withdrawn;
        withdrawals.rrsp += r.withdrawn;
        balances.rrsp = r.newBalance;
      }

      // 4) Optional: attempt to avoid OAS clawback by reducing RRSP/RRIF withdrawals
      // (shifting them to TFSA/non-registered where possible).
      if (vars.withdrawals.avoidOasClawback && (ageShingo >= vars.oasStartAge || ageSarah >= vars.oasStartAge)) {
        const OAS_CLAWBACK_THRESHOLD = 91000; // planning approximation

        const yearsIntoRetirement = i;
        const pensionShingo = indexAmount(DEFAULT_ANCHORS.pensionShingo, yearsIntoRetirement);
        const pensionSarah = indexAmount(DEFAULT_ANCHORS.pensionSarah, yearsIntoRetirement);
        const cppShingo = ageShingo >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppShingoAnnual, yearsIntoRetirement) : 0;
        const cppSarah = ageSarah >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppSarahAnnual, yearsIntoRetirement) : 0;
        const oasShingo = ageShingo >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasShingoAnnual, yearsIntoRetirement) : 0;
        const oasSarah = ageSarah >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasSarahAnnual, yearsIntoRetirement) : 0;

        // Rough taxable income (before pension-splitting optimization). We treat RRSP/RRIF as split 50/50.
        const shingoTaxableRaw = pensionShingo + cppShingo + oasShingo + withdrawals.lira + withdrawals.rrsp * 0.5;
        const sarahTaxableRaw = pensionSarah + cppSarah + oasSarah + withdrawals.rrsp * 0.5;
        const householdTaxable = shingoTaxableRaw + sarahTaxableRaw;

        const assumeSplit50 = vars.tax.enablePensionSplitting;
        const shingoTaxable = assumeSplit50 ? householdTaxable / 2 : shingoTaxableRaw;
        const sarahTaxable = assumeSplit50 ? householdTaxable / 2 : sarahTaxableRaw;

        const excessShingo = ageShingo >= vars.oasStartAge ? Math.max(0, shingoTaxable - OAS_CLAWBACK_THRESHOLD) : 0;
        const excessSarah = ageSarah >= vars.oasStartAge ? Math.max(0, sarahTaxable - OAS_CLAWBACK_THRESHOLD) : 0;

        const neededHouseholdReduction = assumeSplit50
          ? 2 * Math.max(excessShingo, excessSarah)
          : Math.max(excessShingo, excessSarah);

        if (neededHouseholdReduction > 1 && withdrawals.rrsp > 0) {
          // Only reduce RRSP withdrawals by the amount we can replace from TFSA/non-reg.
          let needReplace = Math.min(withdrawals.rrsp, neededHouseholdReduction);

          // Pull replacement cash from TFSA then non-registered.
          let replaced = 0;
          if (needReplace > 0 && vars.withdrawals.allowTfsa && balances.tfsa > 0) {
            const r = withdrawFrom(needReplace, balances.tfsa, vars.withdrawals.caps.tfsa);
            withdrawals.tfsa += r.withdrawn;
            balances.tfsa = r.newBalance;
            replaced += r.withdrawn;
            needReplace = r.remainingNeed;
          }

          if (needReplace > 0 && balances.nonRegistered > 0) {
            const r = withdrawFrom(needReplace, balances.nonRegistered, vars.withdrawals.caps.nonRegistered);
            withdrawals.nonRegistered += r.withdrawn;
            balances.nonRegistered = r.newBalance;
            replaced += r.withdrawn;
            needReplace = r.remainingNeed;
          }

          if (replaced > 0) {
            // Reduce RRSP withdrawal by the amount we replaced, and restore that much to the RRSP balance.
            withdrawals.rrsp -= replaced;
            balances.rrsp += replaced;
          }
        }
      }

      // 5) Estimate tax and make the schedule post-tax.
      // We treat this as a planning approximation (not filing-accurate).
      // If tax is owed, we withdraw additional cash to pay it (which may itself increase taxable income).

      let taxableIncomeShingo = 0;
      let taxableIncomeSarah = 0;

      const estimateHouseholdTaxForYear = () => {
        const yearsIntoRetirement = i;

        const pensionShingo = indexAmount(DEFAULT_ANCHORS.pensionShingo, yearsIntoRetirement);
        const pensionSarah = indexAmount(DEFAULT_ANCHORS.pensionSarah, yearsIntoRetirement);
        const cppShingo = ageShingo >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppShingoAnnual, yearsIntoRetirement) : 0;
        const cppSarah = ageSarah >= vars.cppStartAge ? indexAmount(vars.withdrawals.cppSarahAnnual, yearsIntoRetirement) : 0;
        const oasShingo = ageShingo >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasShingoAnnual, yearsIntoRetirement) : 0;
        const oasSarah = ageSarah >= vars.oasStartAge ? indexAmount(vars.withdrawals.oasSarahAnnual, yearsIntoRetirement) : 0;

        const taxRes = computeHouseholdTax({
          taxYear: year,
          spouseA: {
            name: "Shingo",
            age: ageShingo,
            incomes: {
              employment: 0,
              pensionDb: pensionShingo,
              rrspWithdrawal: 0,
              rrifWithdrawal: withdrawals.rrsp * 0.5,
              lifWithdrawal: withdrawals.lira,
              cpp: cppShingo,
              oas: oasShingo,
              tfsaWithdrawal: withdrawals.tfsa * 0.5,
            },
          },
          spouseB: {
            name: "Sarah",
            age: ageSarah,
            incomes: {
              employment: 0,
              pensionDb: pensionSarah,
              rrspWithdrawal: 0,
              rrifWithdrawal: withdrawals.rrsp * 0.5,
              lifWithdrawal: 0,
              cpp: cppSarah,
              oas: oasSarah,
              tfsaWithdrawal: withdrawals.tfsa * 0.5,
            },
          },
          credits: {
            useBpa: vars.tax.useBpa,
            useAgeAmount: vars.tax.useAgeAmount,
            usePensionCredit: vars.tax.usePensionCredit,
          },
          pensionSplitting: {
            enabled: vars.tax.enablePensionSplitting,
            optimize: true,
            step: 500,
          },
        });

        taxableIncomeShingo = taxRes.spouseA.taxableIncome;
        taxableIncomeSarah = taxRes.spouseB.taxableIncome;
        return taxRes.household.totalTax;
      };

      // Iteratively withdraw enough to pay tax, since taxes depend on withdrawals.
      let tax = 0;
      for (let iter = 0; iter < 3; iter++) {
        tax = estimateHouseholdTaxForYear();

        const totalWithdrawals =
          withdrawals.fhsa +
          withdrawals.rrsp +
          withdrawals.lira +
          withdrawals.nonRegistered +
          withdrawals.tfsa;

        const cashIn = guaranteedIncome + benefitsIncome + totalWithdrawals;
        const surplusBeforeTax = clampToZero(cashIn - targetSpending);
        const extraNeeded = clampToZero(tax - surplusBeforeTax);

        if (extraNeeded <= 1) break;

        // Pull extra cash using the same order (this is simplistic).
        let need = extraNeeded;
        for (const src of vars.withdrawals.order) {
          if (need <= 0) break;
          if (src === "pension") continue;
          if (src === "tfsa" && !vars.withdrawals.allowTfsa) continue;

          if (src === "fhsa") {
            const r = withdrawFrom(need, balances.fhsa, vars.withdrawals.caps.fhsa);
            withdrawals.fhsa += r.withdrawn;
            balances.fhsa = r.newBalance;
            need = r.remainingNeed;
          } else if (src === "rrsp") {
            const r = withdrawFrom(need, balances.rrsp, vars.withdrawals.caps.rrsp);
            withdrawals.rrsp += r.withdrawn;
            balances.rrsp = r.newBalance;
            need = r.remainingNeed;
          } else if (src === "lira") {
            const lifCap = balances.lira * lifFactorApprox(ageShingo, vars.withdrawals.lifMode);
            const explicitCap = vars.withdrawals.caps.lira;
            const cap = explicitCap > 0 ? Math.min(explicitCap, lifCap) : lifCap;
            const r = withdrawFrom(need, balances.lira, cap);
            withdrawals.lira += r.withdrawn;
            balances.lira = r.newBalance;
            need = r.remainingNeed;
          } else if (src === "nonRegistered") {
            const r = withdrawFrom(need, balances.nonRegistered, vars.withdrawals.caps.nonRegistered);
            withdrawals.nonRegistered += r.withdrawn;
            balances.nonRegistered = r.newBalance;
            need = r.remainingNeed;
          } else if (src === "tfsa") {
            const r = withdrawFrom(need, balances.tfsa, vars.withdrawals.caps.tfsa);
            withdrawals.tfsa += r.withdrawn;
            balances.tfsa = r.newBalance;
            need = r.remainingNeed;
          }
        }

        // If we still can't fund taxes, we stop iterating (plan infeasible under these assumptions).
        if (need > 1) break;
      }

      // 5) Any surplus after tax is invested into TFSA / non-registered.
      const totalWithdrawals =
        withdrawals.fhsa +
        withdrawals.rrsp +
        withdrawals.lira +
        withdrawals.nonRegistered +
        withdrawals.tfsa;

      const cashIn = guaranteedIncome + benefitsIncome + totalWithdrawals;
      const surplus = clampToZero(cashIn - targetSpending - tax);

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

      // OAS clawback warning (rough): recovery tax begins above a net income threshold.
      // Using a rounded constant as a planning alert.
      const OAS_CLAWBACK_THRESHOLD = 90000;
      const oasClawbackRiskShingo = ageShingo >= vars.oasStartAge && taxableIncomeShingo >= OAS_CLAWBACK_THRESHOLD;
      const oasClawbackRiskSarah = ageSarah >= vars.oasStartAge && taxableIncomeSarah >= OAS_CLAWBACK_THRESHOLD;

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
        tax,
        taxableIncomeShingo,
        taxableIncomeSarah,
        oasClawbackRiskShingo,
        oasClawbackRiskSarah,
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
            onClick={() => setPage("current")}
            aria-current={page === "current"}
          >
            Current
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

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, opacity: 0.85 }}>
            Dollars:
            <select
              className="dollarsModeSelect"
              value={vars.dollarsMode}
              onChange={(e) =>
                setVars((v) => ({
                  ...v,
                  dollarsMode: e.target.value === "real" ? "real" : "nominal",
                }))
              }
            >
              <option value="nominal">Nominal</option>
              <option value="real">Today’s (real)</option>
            </select>
          </label>

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
            {page === "current" ? "Live snapshot: contributions and totals as of this month" : null}
            {page === "tax" ? "Rough BC+federal tax estimate with simple credits" : null}
            {page === "withdrawals" ? "Drawdown order, caps, and the schedule" : null}
          </div>
        </div>
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {page === "overview" && (
        <>
        <section id="retirementTiming" className="card">
          <h2>Retirement timing</h2>
          {(() => {
            const shingoAge = vars.retirementYear - DEFAULT_ANCHORS.shingoBirthYear;
            const sarahAge = vars.retirementYear - DEFAULT_ANCHORS.sarahBirthYear;
            return (
              <>
                <div className="selectRow">
                  <Field label="Retirement year">
                    <input
                      className="ageInput"
                      type="number"
                      value={vars.retirementYear}
                      onChange={(e) => {
                        const year = num(e.target.value);
                        setVars((v) => ({
                          ...v,
                          retirementYear: year,
                          shingoRetireAge: year - DEFAULT_ANCHORS.shingoBirthYear,
                          sarahRetireAge: year - DEFAULT_ANCHORS.sarahBirthYear,
                          tax: { ...v.tax, taxYear: year },
                        }));
                      }}
                    />
                  </Field>
                  <Field label="Shingo age">
                    <input className="ageInput" type="number" value={shingoAge} disabled />
                  </Field>
                  <Field label="Sarah age">
                    <input className="ageInput" type="number" value={sarahAge} disabled />
                  </Field>
                </div>

                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  Changing the retirement year automatically updates the retirement ages and re-runs the accumulation model
                  up to that year.
                </div>
              </>
            );
          })()}
        </section>

        <section id="expectations" className="card">
          <h2>Expectations (adjustable)</h2>
          <div className="selectRow">
            <Field label="Indexation (partial CPI multiplier)">
              <input
                type="number"
                step="0.05"
                value={vars.cpiMultiplier}
                style={{ maxWidth: 90 }}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    cpiMultiplier: num(e.target.value),
                  }))
                }
              />
            </Field>
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
            <strong>${moneyY(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo), DEFAULT_ANCHORS.baselineYear)}</strong>
            {" "} | Remaining FHSA room (Sarah):{" "}
            <strong>${moneyY(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah), DEFAULT_ANCHORS.baselineYear)}</strong>
          </div>
        </section>

        <section id="retirement-balances" className="card">
          <h2>Starting balances at retirement (projected)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This is calculated by simulating contributions month-by-month from {DEFAULT_ANCHORS.baselineYear} to {vars.retirementYear},
            including FHSA annual/lifetime caps and redirecting any capped FHSA contribution into RRSP.
          </p>
          <ul>
            <li>
              FHSA (household): <strong>${moneyY(model.retirementBalances.fhsa, vars.retirementYear)}</strong>
            </li>
            <li>
              RRSP (household): <strong>${moneyY(model.retirementBalances.rrsp, vars.retirementYear)}</strong>
            </li>
            <li>
              TFSA (household): <strong>${moneyY(model.retirementBalances.tfsa, vars.retirementYear)}</strong>
            </li>
            <li>
              LIRA/LIF (Shingo): <strong>${moneyY(model.retirementBalances.lira, vars.retirementYear)}</strong>
            </li>
            <li>
              Non-registered: <strong>${moneyY(model.retirementBalances.nonRegistered, vars.retirementYear)}</strong>
            </li>
          </ul>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>
              Total ({vars.dollarsMode === "real" ? "today’s dollars" : "nominal"}):{" "}
              <strong>${moneyY(model.totalNominalAtRetirement, vars.retirementYear)}</strong>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
              Toggle Nominal vs Today’s (real) in the top bar.
            </div>
          </div>

          <h3 style={{ marginTop: 14 }}>Accumulation table (years leading up to retirement)</h3>
          <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}>
            <button type="button" className="linkBtn" {...makeScrollHandlers(accumulationTableRef, "accumulation", "edge-left")}>
              ⏮
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(accumulationTableRef, "accumulation", "left")}>
              ◀
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(accumulationTableRef, "accumulation", "right")}>
              ▶
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(accumulationTableRef, "accumulation", "edge-right")}>
              ⏭
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Scroll table horizontally
            </span>
          </div>
          <div
            id="accumulationScheduleWrap"
            className="scheduleWrap"
            ref={accumulationTableRef}
            data-scrolltable="accumulation"
          >
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
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.fhsaContribShingo, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.fhsaContribSarah, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.rrspContribShingo, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.rrspContribSarah, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.tfsaContribTotal, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.estRefundToTfsa, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.endFhsaTotal, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.endRrspTotal, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.endTfsaTotal, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.endLira, r.year)}</td>
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.endTotal, r.year)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 14 }}>Accumulation graph</h3>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            End-of-year balances by account (stacked shading) + total line. Uses the Dollars mode toggle.
          </div>
          {(() => {
            const rows = model.accumulationSchedule;
            if (!rows || rows.length === 0) return null;

            const W = 820;
            const H = 260;
            const padL = 52;
            const padR = 16;
            const padT = 16;
            const padB = 34;

            const xs = rows.map((r) => r.year);
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);

            const get = (r: AccumRow) => {
              const fhsa = adjustDollars(r.endFhsaTotal, r.year);
              const rrsp = adjustDollars(r.endRrspTotal, r.year);
              const tfsa = adjustDollars(r.endTfsaTotal, r.year);
              const lif = adjustDollars(r.endLira, r.year);
              const nonReg = adjustDollars(r.endNonReg, r.year);
              const total = fhsa + rrsp + tfsa + lif + nonReg;
              return { fhsa, rrsp, tfsa, lif, nonReg, total };
            };

            const ysTotal = rows.map((r) => get(r).total);
            const yMin = 0;
            const yMax = Math.max(...ysTotal, 1);

            const xScale = (x: number) =>
              padL + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - padL - padR);
            const yScale = (y: number) =>
              padT + (1 - (y - yMin) / Math.max(1, yMax - yMin)) * (H - padT - padB);

            const series = [
              { key: "fhsa", label: "FHSA", color: "#22c55e" },
              { key: "rrsp", label: "RRSP", color: "#3b82f6" },
              { key: "tfsa", label: "TFSA", color: "#a855f7" },
              { key: "lif", label: "LIF", color: "#f59e0b" },
              { key: "nonReg", label: "NonReg", color: "#64748b" },
            ] as const;

            // Build cumulative stacks
            const stacks = rows.map((r) => {
              const v = get(r);
              const cum: Record<string, number> = {};
              let acc = 0;
              for (const s of series) {
                acc += v[s.key];
                cum[s.key] = acc;
              }
              return { year: r.year, v, cum };
            });

            const areaPath = (key: (typeof series)[number]["key"], prevKey?: (typeof series)[number]["key"]) => {
              const top = stacks.map((p) => ({ x: xScale(p.year), y: yScale(p.cum[key]) }));
              const base = stacks
                .slice()
                .reverse()
                .map((p) => ({ x: xScale(p.year), y: yScale(prevKey ? p.cum[prevKey] : 0) }));
              const pts = top.concat(base);
              return pts
                .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
                .join(" ") + " Z";
            };

            const linePath = (key: (typeof series)[number]["key"]) =>
              stacks
                .map((p, i) => {
                  const x = xScale(p.year);
                  const y = yScale(p.cum[key]);
                  return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
                })
                .join(" ");

            const totalPath = stacks
              .map((p, i) => {
                const x = xScale(p.year);
                const y = yScale(p.v.total);
                return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
              })
              .join(" ");

            const start = stacks[0];
            const end = stacks[stacks.length - 1];

            return (
              <div style={{ marginTop: 10, overflowX: "auto" }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, display: "block" }}>
                  <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e5e7eb" />
                  <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#e5e7eb" />

                  {/* stacked shaded areas */}
                  {series.map((s, idx) => (
                    <path
                      key={s.key}
                      d={areaPath(s.key, idx === 0 ? undefined : series[idx - 1].key)}
                      fill={s.color}
                      opacity={0.12}
                      stroke="none"
                    />
                  ))}

                  {/* boundary lines for each stack */}
                  {series.map((s) => (
                    <path key={`line-${s.key}`} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={1.5} opacity={0.9} />
                  ))}

                  {/* total line */}
                  <path d={totalPath} fill="none" stroke="#0f172a" strokeWidth={2.5} />

                  {/* year tick marks */}
                  {(() => {
                    const desiredTicks = 6;
                    const step = Math.max(1, Math.round((xMax - xMin) / desiredTicks));
                    const ticks: number[] = [];
                    for (let y = xMin; y <= xMax; y += step) ticks.push(y);
                    if (ticks[ticks.length - 1] !== xMax) ticks.push(xMax);

                    return ticks.map((y) => {
                      const x = xScale(y);
                      return (
                        <g key={`tick-${y}`}>
                          <line x1={x} y1={H - padB} x2={x} y2={H - padB + 4} stroke="#cbd5e1" />
                          <text x={x} y={H - 10} fontSize={12} fill="#64748b" textAnchor="middle">
                            {y}
                          </text>
                        </g>
                      );
                    });
                  })()}
                  <text x={padL} y={padT + 10} fontSize={12} fill="#64748b" textAnchor="start">{money(yMax)}</text>
                  <text x={padL} y={H - padB - 6} fontSize={12} fill="#64748b" textAnchor="start">{money(0)}</text>
                </svg>

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
                  {series.map((s) => (
                    <div key={`legend-${s.key}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 10, height: 10, background: s.color, display: "inline-block", borderRadius: 2, opacity: 0.8 }} />
                      <span style={{ opacity: 0.85 }}>{s.label}</span>
                    </div>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 14, height: 2, background: "#0f172a", display: "inline-block" }} />
                    <span style={{ opacity: 0.85 }}>Total</span>
                  </div>
                </div>

                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                  {start.year}: <strong>${moneyY(start.v.total, start.year)}</strong> → {end.year}: <strong>${moneyY(end.v.total, end.year)}</strong>
                </div>
              </div>
            );
          })()}
        </section>

        </>
        )}

        {page === "current" && (
        <section id="current" className="card">
          <h2>Current snapshot</h2>
          {(() => {
            const now = new Date();
            const nowYear = now.getFullYear();
            const nowMonth = now.getMonth(); // 0-11

            const monthsElapsed = Math.max(
              0,
              (nowYear - DEFAULT_ANCHORS.baselineYear) * 12 + nowMonth
            );

            // Simulate month-by-month from baseline to the start of the current month.
            const r = vars.expectedNominalReturn / 12;

            let fhsaS = vars.balances.fhsaShingo;
            let fhsaSa = vars.balances.fhsaSarah;
            let rrspS = vars.balances.rrspShingo;
            let rrspSa = vars.balances.rrspSarah;
            let tfsaS = vars.balances.tfsaShingo;
            let tfsaSa = vars.balances.tfsaSarah;
            let lira = vars.balances.liraShingo;
            let nonReg = vars.balances.nonRegistered;

            let roomFhsaS = Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo);
            let roomFhsaSa = Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah);

            let fhsaAnnualUsedS = 0;
            let fhsaAnnualUsedSa = 0;

            for (let m = 0; m < monthsElapsed; m++) {
              // const year = DEFAULT_ANCHORS.baselineYear + Math.floor(m / 12);

              if (m % 12 === 0) {
                fhsaAnnualUsedS = 0;
                fhsaAnnualUsedSa = 0;
              }

              // TFSA split (household)
              const tfsaEach = vars.monthly.tfsaTotal / 2;

              // RRSP base
              let rrspContribS = vars.monthly.rrspShingo;
              let rrspContribSa = vars.monthly.rrspSarah;

              // FHSA with annual + lifetime caps; overflow -> RRSP
              let fhsaContribS = vars.monthly.fhsaShingo;
              fhsaContribS = Math.min(fhsaContribS, Math.max(0, vars.fhsa.annualLimit - fhsaAnnualUsedS));
              fhsaContribS = Math.min(fhsaContribS, roomFhsaS);
              const overflowS = vars.monthly.fhsaShingo - fhsaContribS;
              if (overflowS > 0) rrspContribS += overflowS;

              let fhsaContribSa = vars.monthly.fhsaSarah;
              fhsaContribSa = Math.min(fhsaContribSa, Math.max(0, vars.fhsa.annualLimit - fhsaAnnualUsedSa));
              fhsaContribSa = Math.min(fhsaContribSa, roomFhsaSa);
              const overflowSa = vars.monthly.fhsaSarah - fhsaContribSa;
              if (overflowSa > 0) rrspContribSa += overflowSa;

              // apply contribs
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

              // growth
              fhsaS *= 1 + r;
              fhsaSa *= 1 + r;
              rrspS *= 1 + r;
              rrspSa *= 1 + r;
              tfsaS *= 1 + r;
              tfsaSa *= 1 + r;
              lira *= 1 + r;
              nonReg *= 1 + r;
            }

            const currentLabel = now.toLocaleString(undefined, { month: "long", year: "numeric" });
            const yearForDollars = nowYear; // approximate

            const totals = {
              fhsa: fhsaS + fhsaSa,
              rrsp: rrspS + rrspSa,
              tfsa: tfsaS + tfsaSa,
              lira,
              nonReg,
            };

            const grandTotal = totals.fhsa + totals.rrsp + totals.tfsa + totals.lira + totals.nonReg;

            return (
              <>
                <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
                  As of <strong>{currentLabel}</strong> (simulated from baseline {DEFAULT_ANCHORS.baselineYear} using your current monthly contributions and return assumptions).
                </p>

                <h3 style={{ marginTop: 14 }}>Contribution room (editable)</h3>
                <div className="tightGrid">
                  <Field label="TFSA room Shingo (as of 2026, $)">
                    <input
                      type="number"
                      step={1}
                      value={Math.round(vars.tfsaRoomShingo)}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tfsaRoomShingo: Math.round(num(e.target.value)),
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA room Sarah (as of 2026, $)">
                    <input
                      type="number"
                      step={1}
                      value={Math.round(vars.tfsaRoomSarah)}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tfsaRoomSarah: Math.round(num(e.target.value)),
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP room Shingo (as of 2025 limit, $)">
                    <input
                      type="number"
                      value={vars.rrspRoomShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          rrspRoomShingo: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP room Sarah (as of 2025 limit, $)">
                    <input
                      type="number"
                      value={vars.rrspRoomSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          rrspRoomSarah: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                </div>

                <h3 style={{ marginTop: 14 }}>Current balances (editable)</h3>
                <div className="tightGrid">
                  <Field label="FHSA Shingo (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.fhsaShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, fhsaShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="FHSA Sarah (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.fhsaSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, fhsaSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Shingo (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.rrspShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, rrspShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Sarah (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.rrspSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, rrspSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA Shingo (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.tfsaShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, tfsaShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA Sarah (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.tfsaSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, tfsaSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="LIRA/LIF Shingo (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.liraShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, liraShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Non-registered (starting, $)">
                    <input
                      type="number"
                      value={vars.balances.nonRegistered}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balances: { ...v.balances, nonRegistered: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                </div>

                <h3 style={{ marginTop: 14 }}>Current monthly contributions (editable)</h3>
                <div className="tightGrid">
                  <Field label="FHSA Shingo ($/mo)">
                    <input
                      type="number"
                      value={vars.monthly.fhsaShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          monthly: { ...v.monthly, fhsaShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="FHSA Sarah ($/mo)">
                    <input
                      type="number"
                      value={vars.monthly.fhsaSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          monthly: { ...v.monthly, fhsaSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Shingo ($/mo)">
                    <input
                      type="number"
                      value={vars.monthly.rrspShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          monthly: { ...v.monthly, rrspShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Sarah ($/mo)">
                    <input
                      type="number"
                      value={vars.monthly.rrspSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          monthly: { ...v.monthly, rrspSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA household ($/mo)">
                    <input
                      type="number"
                      value={vars.monthly.tfsaTotal}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          monthly: { ...v.monthly, tfsaTotal: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                  Annualized totals: FHSA Shingo <strong>${moneyY(vars.monthly.fhsaShingo * 12, yearForDollars)}</strong>,
                  FHSA Sarah <strong>${moneyY(vars.monthly.fhsaSarah * 12, yearForDollars)}</strong>,
                  RRSP Shingo <strong>${moneyY(vars.monthly.rrspShingo * 12, yearForDollars)}</strong>,
                  RRSP Sarah <strong>${moneyY(vars.monthly.rrspSarah * 12, yearForDollars)}</strong>,
                  TFSA household <strong>${moneyY(vars.monthly.tfsaTotal * 12, yearForDollars)}</strong>
                </div>

                <h3 style={{ marginTop: 14 }}>Current totals</h3>
                <ul style={{ marginTop: 8 }}>
                  <li>FHSA (household): <strong>${moneyY(totals.fhsa, yearForDollars)}</strong></li>
                  <li>RRSP (household): <strong>${moneyY(totals.rrsp, yearForDollars)}</strong></li>
                  <li>TFSA (household): <strong>${moneyY(totals.tfsa, yearForDollars)}</strong></li>
                  <li>LIRA/LIF (Shingo): <strong>${moneyY(totals.lira, yearForDollars)}</strong></li>
                  <li>Non-registered: <strong>${moneyY(totals.nonReg, yearForDollars)}</strong></li>
                </ul>

                <div style={{ marginTop: 10 }}>
                  Total ({vars.dollarsMode === "real" ? "today’s dollars" : "nominal"}):{" "}
                  <strong>${moneyY(grandTotal, yearForDollars)}</strong>
                </div>
              </>
            );
          })()}
        </section>
        )}

        {page === "tax" && (
        <section id="tax" className="card">
          <h2>Tax estimate (BC + federal) — v2</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            Planning estimator. Computes tax per person (federal + BC), applies selected non-refundable credits,
            optionally optimizes pension-income splitting, and estimates OAS clawback.
          </p>

          {(() => {
            const shingoAge = vars.tax.taxYear - DEFAULT_ANCHORS.shingoBirthYear;
            const sarahAge = vars.tax.taxYear - DEFAULT_ANCHORS.sarahBirthYear;

            const res = computeHouseholdTax({
              taxYear: vars.tax.taxYear,
              spouseA: {
                name: "Shingo",
                age: shingoAge,
                incomes: {
                  employment: vars.tax.shingoEmployment,
                  pensionDb: vars.tax.shingoPensionDb,
                  rrspWithdrawal: vars.tax.shingoRrsp,
                  rrifWithdrawal: vars.tax.shingoRrif,
                  lifWithdrawal: vars.tax.shingoLif,
                  cpp: vars.tax.shingoCpp,
                  oas: vars.tax.shingoOas,
                  tfsaWithdrawal: vars.tax.shingoTfsa,
                },
              },
              spouseB: {
                name: "Sarah",
                age: sarahAge,
                incomes: {
                  employment: vars.tax.sarahEmployment,
                  pensionDb: vars.tax.sarahPensionDb,
                  rrspWithdrawal: vars.tax.sarahRrsp,
                  rrifWithdrawal: vars.tax.sarahRrif,
                  lifWithdrawal: vars.tax.sarahLif,
                  cpp: vars.tax.sarahCpp,
                  oas: vars.tax.sarahOas,
                  tfsaWithdrawal: vars.tax.sarahTfsa,
                },
              },
              credits: {
                useBpa: vars.tax.useBpa,
                useAgeAmount: vars.tax.useAgeAmount,
                usePensionCredit: vars.tax.usePensionCredit,
              },
              pensionSplitting: {
                enabled: vars.tax.enablePensionSplitting,
                optimize: true,
                step: 250,
              },
            });

            const showLine = (label: string, value: number) => (
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <span style={{ opacity: 0.85 }}>{label}</span>
                <strong>${moneyY(value, vars.tax.taxYear)}</strong>
              </div>
            );

            return (
              <>
                <div className="selectRow">
                  <Field label="Tax year">
                    <input
                      className="ageInput"
                      type="number"
                      value={vars.tax.taxYear}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tax: { ...v.tax, taxYear: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>

                  <Field label="Pension splitting?">
                    <select
                      className="yesNoSelect"
                      value={vars.tax.enablePensionSplitting ? "yes" : "no"}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tax: { ...v.tax, enablePensionSplitting: e.target.value === "yes" },
                        }))
                      }
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>

                  <Field label="BPA">
                    <select
                      className="yesNoSelect"
                      value={vars.tax.useBpa ? "yes" : "no"}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tax: { ...v.tax, useBpa: e.target.value === "yes" },
                        }))
                      }
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>

                  <Field label="Age amount">
                    <select
                      className="yesNoSelect"
                      value={vars.tax.useAgeAmount ? "yes" : "no"}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tax: { ...v.tax, useAgeAmount: e.target.value === "yes" },
                        }))
                      }
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>

                  <Field label="Pension credit">
                    <select
                      className="yesNoSelect"
                      value={vars.tax.usePensionCredit ? "yes" : "no"}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          tax: { ...v.tax, usePensionCredit: e.target.value === "yes" },
                        }))
                      }
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </Field>
                </div>

                <h3 style={{ marginTop: 14 }}>Income inputs (by source)</h3>
                <div className="grid">
                  <div>
                    <h4 style={{ margin: "6px 0" }}>Shingo</h4>
                    <div className="tightGrid">
                      <Field label={`Age (${shingoAge})`}>
                        <input className="ageInput" type="number" value={shingoAge} disabled />
                      </Field>
                      <Field label="DB pension ($/yr)">
                        <input type="number" value={vars.tax.shingoPensionDb} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoPensionDb:num(e.target.value)}}))} />
                      </Field>
                      <Field label="CPP ($/yr)">
                        <input type="number" value={vars.tax.shingoCpp} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoCpp:num(e.target.value)}}))} />
                      </Field>
                      <Field label="OAS ($/yr)">
                        <input type="number" value={vars.tax.shingoOas} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoOas:num(e.target.value)}}))} />
                      </Field>
                      <Field label="RRIF ($/yr)">
                        <input type="number" value={vars.tax.shingoRrif} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoRrif:num(e.target.value)}}))} />
                      </Field>
                      <Field label="LIF ($/yr)">
                        <input type="number" value={vars.tax.shingoLif} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoLif:num(e.target.value)}}))} />
                      </Field>
                      <Field label="RRSP w/d ($/yr)">
                        <input type="number" value={vars.tax.shingoRrsp} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoRrsp:num(e.target.value)}}))} />
                      </Field>
                      <Field label="TFSA w/d ($/yr)">
                        <input type="number" value={vars.tax.shingoTfsa} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoTfsa:num(e.target.value)}}))} />
                      </Field>
                      <Field label="Other taxable ($/yr)">
                        <input type="number" value={vars.tax.shingoEmployment} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, shingoEmployment:num(e.target.value)}}))} />
                      </Field>
                    </div>
                  </div>

                  <div>
                    <h4 style={{ margin: "6px 0" }}>Sarah</h4>
                    <div className="tightGrid">
                      <Field label={`Age (${sarahAge})`}>
                        <input className="ageInput" type="number" value={sarahAge} disabled />
                      </Field>
                      <Field label="DB pension ($/yr)">
                        <input type="number" value={vars.tax.sarahPensionDb} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahPensionDb:num(e.target.value)}}))} />
                      </Field>
                      <Field label="CPP ($/yr)">
                        <input type="number" value={vars.tax.sarahCpp} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahCpp:num(e.target.value)}}))} />
                      </Field>
                      <Field label="OAS ($/yr)">
                        <input type="number" value={vars.tax.sarahOas} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahOas:num(e.target.value)}}))} />
                      </Field>
                      <Field label="RRIF ($/yr)">
                        <input type="number" value={vars.tax.sarahRrif} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahRrif:num(e.target.value)}}))} />
                      </Field>
                      <Field label="LIF ($/yr)">
                        <input type="number" value={vars.tax.sarahLif} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahLif:num(e.target.value)}}))} />
                      </Field>
                      <Field label="RRSP w/d ($/yr)">
                        <input type="number" value={vars.tax.sarahRrsp} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahRrsp:num(e.target.value)}}))} />
                      </Field>
                      <Field label="TFSA w/d ($/yr)">
                        <input type="number" value={vars.tax.sarahTfsa} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahTfsa:num(e.target.value)}}))} />
                      </Field>
                      <Field label="Other taxable ($/yr)">
                        <input type="number" value={vars.tax.sarahEmployment} onChange={(e)=>setVars(v=>({...v, tax:{...v.tax, sarahEmployment:num(e.target.value)}}))} />
                      </Field>
                    </div>
                  </div>
                </div>

                <h3 style={{ marginTop: 14 }}>Results</h3>
                <div className="grid">
                  <div className="card" style={{ padding: 12 }}>
                    <h4 style={{ margin: "0 0 8px 0" }}>Shingo</h4>
                    {showLine("Taxable income", res.spouseA.taxableIncome)}
                    {showLine("Fed tax (pre-credits)", res.spouseA.federalTaxBeforeCredits)}
                    {showLine("BC tax (pre-credits)", res.spouseA.bcTaxBeforeCredits)}
                    {showLine("Credits applied", res.spouseA.credits.total)}
                    {showLine("OAS clawback", res.spouseA.oasClawback)}
                    {showLine("Total tax", res.spouseA.totalTax)}
                    {showLine("After-tax", res.spouseA.afterTaxIncome)}
                  </div>
                  <div className="card" style={{ padding: 12 }}>
                    <h4 style={{ margin: "0 0 8px 0" }}>Sarah</h4>
                    {showLine("Taxable income", res.spouseB.taxableIncome)}
                    {showLine("Fed tax (pre-credits)", res.spouseB.federalTaxBeforeCredits)}
                    {showLine("BC tax (pre-credits)", res.spouseB.bcTaxBeforeCredits)}
                    {showLine("Credits applied", res.spouseB.credits.total)}
                    {showLine("OAS clawback", res.spouseB.oasClawback)}
                    {showLine("Total tax", res.spouseB.totalTax)}
                    {showLine("After-tax", res.spouseB.afterTaxIncome)}
                  </div>
                </div>

                <div className="card" style={{ padding: 12, marginTop: 12 }}>
                  <h4 style={{ margin: "0 0 8px 0" }}>Household</h4>
                  {showLine("Household taxable income", res.household.taxableIncome)}
                  {showLine("Household OAS clawback", res.household.oasClawback)}
                  {showLine("Household total tax", res.household.totalTax)}
                  {showLine("Household after-tax", res.household.afterTaxIncome)}
                  {vars.tax.enablePensionSplitting ? (
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                      Splitting chosen: <strong>${moneyY(res.debug.splitting.chosenSplitAmount, vars.tax.taxYear)}</strong>
                      {res.debug.splitting.from && res.debug.splitting.to ? (
                        <span> ({res.debug.splitting.from} → {res.debug.splitting.to})</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}>Debug</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, background: "#f8fafc", border: "1px solid #e5e7eb", padding: 10, borderRadius: 10, marginTop: 8 }}>
                    {JSON.stringify(res.debug, null, 2)}
                  </pre>
                </details>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}>Working-year refund model (separate)</summary>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                    This refund estimate is only used in the accumulation model (working years) for RRSP/FHSA deductions.
                    Retirement years do not include withholding/refunds.
                  </div>
                  <div className="selectRow" style={{ marginTop: 8 }}>
                    <Field label="Refund → TFSA">
                      <select
                        className="yesNoSelect"
                        value={vars.tax.enableRefundToTfsa ? "yes" : "no"}
                        onChange={(e) =>
                          setVars((v) => ({
                            ...v,
                            tax: { ...v.tax, enableRefundToTfsa: e.target.value === "yes" },
                          }))
                        }
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </Field>
                    <Field label="Working income Shingo ($/yr)">
                      <input
                        className="moneyInputLg"
                        type="number"
                        value={vars.tax.workingIncomeShingo}
                        onChange={(e) =>
                          setVars((v) => ({
                            ...v,
                            tax: { ...v.tax, workingIncomeShingo: num(e.target.value) },
                          }))
                        }
                      />
                    </Field>
                    <Field label="Working income Sarah ($/yr)">
                      <input
                        className="moneyInputLg"
                        type="number"
                        value={vars.tax.workingIncomeSarah}
                        onChange={(e) =>
                          setVars((v) => ({
                            ...v,
                            tax: { ...v.tax, workingIncomeSarah: num(e.target.value) },
                          }))
                        }
                      />
                    </Field>
                  </div>
                </details>
              </>
            );
          })()}
        </section>
        )}

        {page === "withdrawals" && (
        <section id="withdrawals" className="card">
          <h2>Withdrawal schedule (simple v1)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This schedule is <strong>annual</strong> and includes a simple <strong>tax estimate</strong>.
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

            <Field label="RRIF front-load (0–1)
(0=even, 1=aggressive)">
              <input
                className="compactNumber"
                type="number"
                step="0.05"
                min={0}
                max={1}
                value={vars.withdrawals.rrifFrontLoad}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      rrifFrontLoad: clamp01(num(e.target.value)),
                    },
                  }))
                }
              />
            </Field>

            <Field label="Avoid OAS clawback\n(shift RRSP→TFSA/NonReg)">
              <select
                className="yesNoSelect"
                value={vars.withdrawals.avoidOasClawback ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      avoidOasClawback: e.target.value === "yes",
                    },
                  }))
                }
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
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
          <label style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-start", fontSize: 12, opacity: 0.85, marginTop: 6 }}>
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

          {model.schedule.some((r) => r.oasClawbackRiskShingo || r.oasClawbackRiskSarah) ? (
            <div style={{ marginTop: 10, padding: 10, border: "1px solid #fecaca", background: "#fff1f2", borderRadius: 10, fontSize: 12 }}>
              <strong>OAS clawback alert (rough):</strong>
              {" "}
              <span style={{ color: "#b91c1c", fontWeight: 700 }}>
                {model.schedule
                  .filter((r) => r.oasClawbackRiskShingo || r.oasClawbackRiskSarah)
                  .map((r) => r.year)
                  .join(", ")}
              </span>
              {" "}
              (year(s) potentially above threshold). Consider lowering registered withdrawals, improving splitting, or deferring OAS.
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0", flexWrap: "wrap" }}>
            <button type="button" className="linkBtn" {...makeScrollHandlers(withdrawalTableRef, "withdrawal", "edge-left")}>
              ⏮
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(withdrawalTableRef, "withdrawal", "left")}>
              ◀
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(withdrawalTableRef, "withdrawal", "right")}>
              ▶
            </button>
            <button type="button" className="linkBtn" {...makeScrollHandlers(withdrawalTableRef, "withdrawal", "edge-right")}>
              ⏭
            </button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Scroll table horizontally
            </span>
          </div>
          <div
            id="withdrawalScheduleWrap"
            className="scheduleWrap"
            ref={withdrawalTableRef}
            data-scrolltable="withdrawal"
          >
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
                    // (removed W/d FHSA)
                    ["W/d", "RRSP"],
                    ["W/d", "LIF"],
                    // (removed W/d NonReg)
                    // (removed W/d TFSA)
                    // (removed Forced LIF)
                    // (removed Forced RRIF)
                    ["Tax", "$/yr"],
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
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.targetSpending, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.guaranteedIncome, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.benefitsIncome, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.targetSpending - r.guaranteedIncome - r.benefitsIncome, r.year)}</td>
                      {/* removed W/d FHSA */}
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.withdrawals.rrsp, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.withdrawals.lira, r.year)}</td>
                      {/* removed W/d NonReg */}
                      {/* removed W/d TFSA */}
                      {/* removed Forced LIF */}
                      {/* removed Forced RRIF */}
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.tax, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.surplusInvestedToTfsa, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.surplusInvestedToNonReg, r.year)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(endTotal, r.year)}</td>
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
          Note: withdrawal schedule includes a simplified tax estimate and remains approximate.
        </div>
      </footer>
    </div>
  );
}
