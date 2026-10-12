import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { supabase } from "./lib/supabase";
import { Modal, SettingsButton } from "./Modal";
import { PercentInput } from "./PercentInput";
import {
  DEFAULT_ANCHORS,
  DEFAULT_VARIABLES,
  PENSION_SARAH_STATEMENT_YEAR,
  WORKING_MONTHS_IN_RETIREMENT_YEAR,
  projectedPensionSarah,
  type Anchors,
  type AccountBalances,
  type MonthlyContributions,
  type Variables,
  type WithdrawalOrder,
  type LifMode,
} from "./planDefaults";
import { loadPlan, savePlan, loadPublicRules } from "./lib/db";
import { accumulationTimeline } from "./accumulationTimeline";
import { AccumulationGraph } from "./AccumulationGraph";
import { updateTfsaLimitsFromDb } from "./data/publicRules";
import { updateRrifFactorsFromDb, updateBcLifMaxFromDb } from "./withdrawals/engine";
import { computeHouseholdTax } from "./tax/v2";
import { getBracketTableForYear } from "./tax/tables";
import { buildWithdrawalSchedule } from "./withdrawals/engine";
import { incomeGrowthFactor } from "./incomeGrowth";
import { buildAccumulationSchedule, calculateBalancesToDate, type AccumPosition } from "./accumulation";
import { WithdrawalStrategies } from "./WithdrawalStrategies";

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
  // Nearest dollar. (This used to round UP, which turned $0.34 into "$1" and
  // made totals disagree with their own parts.)
  const rounded = Math.round(n);
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



// (futureValueMonthly removed: all accounts now project through buildAccumulationSchedule)

// (removed unused helper)


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

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}


export default function App() {
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState("");
  const [anchors, setAnchors] = useState<Anchors>(() => {
    const saved = localStorage.getItem("retirementPlan");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.anchors) return { ...DEFAULT_ANCHORS, ...data.anchors };
      } catch {
        // ignore parse errors, use default
      }
    }
    return DEFAULT_ANCHORS;
  });
  const [vars, setVars] = useState<Variables>(() => {
    const saved = localStorage.getItem("retirementPlan");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        // Merge over defaults so plans saved before a new field existed still get it.
        if (data.vars) return { ...DEFAULT_VARIABLES, ...data.vars };
      } catch {
        // ignore parse errors, use default
      }
    }
    return DEFAULT_VARIABLES;
  });
  const [dbLoading, setDbLoading] = useState(true);
  const [saveErrors, setSaveErrors] = useState<{ what: string; message: string }[]>([]);
  const planIdRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedSnapshotRef = useRef<{ balances: Variables["balances"]; asOf: string } | null>(null);
  const [showingSavedSnapshot, setShowingSavedSnapshot] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState<{ balances: Variables["balances"]; asOf: string } | null>(null);

  // Auth: check session on mount
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
    } else if (isSignUp) {
      setAuthError("Check your email to confirm your account, then sign in.");
    }
  }

  // Load plan and public rules from DB on mount
  useEffect(() => {
    if (!user) return;
    Promise.all([loadPlan(), loadPublicRules()]).then(([plan, rules]) => {
      if (plan) {
        planIdRef.current = plan.planId;
        setAnchors(plan.anchors);

        const ov = plan.varsOverrides;
        const rawBalances = ov.balances ?? DEFAULT_VARIABLES.balances;
        const rawAsOf = ov.balancesAsOf ?? DEFAULT_VARIABLES.balancesAsOf;

        // Store raw snapshot for the "back" button — set before setVars triggers a render
        savedSnapshotRef.current = { balances: rawBalances, asOf: rawAsOf };
        setSavedSnapshot({ balances: rawBalances, asOf: rawAsOf });

        setVars((v) => ({
          ...v,
          ...ov,
          withdrawals: { ...v.withdrawals, ...ov.withdrawals },
        }));
      }
      if (rules) {
        updateTfsaLimitsFromDb(rules.tfsaLimitsByYear);
        updateRrifFactorsFromDb(rules.rrifFactors);
        updateBcLifMaxFromDb(rules.bcLifMax);
      }
      setDbLoading(false);
    });
  }, [user]);

  // Auto-save: to DB if logged in with a plan, otherwise localStorage
  useEffect(() => {
    if (dbLoading) return;
    // Skip if no user (local mode) or no plan yet
    if (!user || !planIdRef.current) {
      localStorage.setItem("retirementPlan", JSON.stringify({ anchors, vars }));
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // savePlan reports rather than throws; an unwatched failure is how the
      // account balances quietly stopped saving.
      savePlan(planIdRef.current!, anchors, vars).then(setSaveErrors);
    }, 1000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [anchors, vars, dbLoading, user]);

  const [page, setPage] = useState<"overview" | "current" | "tax" | "withdrawals">("overview");

  const [settingsPanel, setSettingsPanel] = useState<

    "order" | "accounts" | "lif" | "caps" | "room"
    | "fhsa" | "monthly" | "pensions" | "benefits" | null

  >(null);

  const closeSettingsPanel = useCallback(() => setSettingsPanel(null), []);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [suggestedRrifDepleteByAge, setSuggestedRrifDepleteByAge] = useState<number | null>(null);
  const [suggestedRrifInfo, setSuggestedRrifInfo] = useState<string>("");

  const [currentSnapshotYear, setCurrentSnapshotYear] = useState(() => new Date().getFullYear());

  const adjustDollars = (amountNominal: number, year: number) => {
    if (vars.dollarsMode !== "real") return amountNominal;
    const yearsFromBaseline = year - anchors.baselineYear;
    return toRealDollars(amountNominal, vars.expectedInflation, yearsFromBaseline);
  };

  const moneyY = (amountNominal: number, year: number) => money(adjustDollars(amountNominal, year));

  // (indexAmount removed; withdrawal engine handles indexation internally)

  const withdrawalTableRef = useRef<HTMLDivElement | null>(null);
  const accumulationTableRef = useRef<HTMLDivElement | null>(null);

  // getScrollEl removed (scroll navigation buttons removed)

  // scrollTable removed (scroll navigation buttons removed)

  // scroll navigation buttons removed

  // navigation uses page tabs now

  const baselineTotal = useMemo(() => sumBalances(vars.balances), [vars.balances]);
  const monthlyTotal = useMemo(() => sumMonthly(vars.monthly), [vars.monthly]);

  const model = useMemo(() => {
    // Grow saved balances from balancesAsOf to today (interest only, no contributions).
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const savedDate = vars.balancesAsOf ? new Date(vars.balancesAsOf + "T00:00:00") : null;
    const daysElapsed = savedDate
      ? Math.max(0, (today.getTime() - savedDate.getTime()) / 86400000)
      : 0;
    const interestGrowth = Math.pow(1 + vars.expectedNominalReturn, daysElapsed / 365);
    const todayBalances = {
      fhsaShingo:    vars.balances.fhsaShingo    * interestGrowth,
      fhsaSarah:     vars.balances.fhsaSarah     * interestGrowth,
      rrspShingo:    vars.balances.rrspShingo    * interestGrowth,
      rrspSarah:     vars.balances.rrspSarah     * interestGrowth,
      tfsaShingo:    vars.balances.tfsaShingo    * interestGrowth,
      tfsaSarah:     vars.balances.tfsaSarah     * interestGrowth,
      liraShingo:    vars.balances.liraShingo    * interestGrowth,
      nonRegistered: vars.balances.nonRegistered * interestGrowth,
    };

    // Months from today to retirement (for non-registered future-value calc).
    const monthsFromTodayToRetirement = Math.max(
      0,
      (vars.retirementYear - today.getFullYear()) * 12 - today.getMonth()
    );

    const accumulationSchedule = buildAccumulationSchedule({
      baselineYear: anchors.baselineYear,
      retirementYear: vars.retirementYear,
      annualReturn: vars.expectedNominalReturn,
      fhsaShingo: todayBalances.fhsaShingo,
      fhsaSarah: todayBalances.fhsaSarah,
      rrspShingo: todayBalances.rrspShingo,
      rrspSarah: todayBalances.rrspSarah,
      tfsaShingo: todayBalances.tfsaShingo,
      tfsaSarah: todayBalances.tfsaSarah,
      liraShingo: todayBalances.liraShingo,
      nonRegistered: todayBalances.nonRegistered,
      tfsaRoomShingo: vars.tfsaRoomShingo,
      tfsaRoomSarah: vars.tfsaRoomSarah,
      rrspRoomShingo: vars.rrspRoomShingo,
      rrspRoomSarah: vars.rrspRoomSarah,
      earnedIncomeShingo: vars.earnedIncomeShingo,
      earnedIncomeSarah: vars.earnedIncomeSarah,
      earnedIncomeYear: vars.earnedIncomeYear ?? 2025,
      incomeGrowthRate: vars.incomeGrowthRate ?? 0.02,
      rrspDollarLimit: vars.rrspDollarLimit ?? 33810,
      rrspDollarLimitYear: vars.rrspDollarLimitYear ?? 2026,
      pensionAdjustmentShingo: vars.pensionAdjustmentShingo ?? 0,
      pensionAdjustmentSarah: vars.pensionAdjustmentSarah ?? 0,
      annualInflation: vars.expectedInflation,
      nonRegTaxDragRate: vars.nonRegTaxDragRate ?? 0,
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
      tfsaIncludesRefund: vars.tfsaIncludesRefund ?? false,
      balancesAsOf: todayStr,
      workingMonthsInRetirementYear: WORKING_MONTHS_IN_RETIREMENT_YEAR,
    });

    const lastAccum = accumulationSchedule[accumulationSchedule.length - 1];

    // The same schedule on a real calendar for the graph: today, each
    // 1 January, then the retirement month.
    const accumulationTimelinePoints = accumulationTimeline({
      rows: accumulationSchedule,
      today: {
        year: Number(todayStr.slice(0, 4)),
        month: Number(todayStr.slice(5, 7)) - 1,
        balances: todayBalances,
      },
      retirementYear: vars.retirementYear,
      workingMonthsInRetirementYear: WORKING_MONTHS_IN_RETIREMENT_YEAR,
    });

    // Where things stand today: balances grown to today, room as entered.
    const todayPosition: AccumPosition = {
      balances: todayBalances,
      room: {
        tfsaShingo: Math.max(0, vars.tfsaRoomShingo),
        tfsaSarah: Math.max(0, vars.tfsaRoomSarah),
        rrspShingo: Math.max(0, vars.rrspRoomShingo),
        rrspSarah: Math.max(0, vars.rrspRoomSarah),
        fhsaShingo: Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo),
        fhsaSarah: Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah),
      },
    };

    // TFSA room left on the day they retire, from the same simulation that
    // used it up. (This was a hand-entered figure, last worked out for a
    // January 2026 snapshot, so it drifted away from what the plan saved.)
    const tfsaRoomAtRetirement = lastAccum
      ? lastAccum.end.room.tfsaShingo + lastAccum.end.room.tfsaSarah
      : vars.tfsaRoomShingo + vars.tfsaRoomSarah;

    // Non-registered comes from the same accumulation loop as every other
    // account. (It used to be projected separately with futureValueMonthly,
    // so the number in the accumulation table could disagree with the number
    // actually fed into the withdrawal engine.)
    const retirementBalances: RetirementBalances = {
      fhsa: lastAccum?.endFhsaTotal ?? 0,
      rrsp: lastAccum?.endRrspTotal ?? 0,
      tfsa: lastAccum?.endTfsaTotal ?? 0,
      lira: lastAccum?.endLira ?? 0,
      nonRegistered: lastAccum?.endNonReg ?? todayBalances.nonRegistered,
    };

    // Note: FHSA rollover behavior is handled in the withdrawal engine.
    // We keep FHSA separate here so the overview + accumulation outputs always show FHSA explicitly.

    const totalNominalAtRetirement =
      retirementBalances.fhsa +
      retirementBalances.rrsp +
      retirementBalances.tfsa +
      retirementBalances.lira +
      retirementBalances.nonRegistered;

    const yearsToRetirement = vars.retirementYear - anchors.baselineYear;
    const monthsToRetirement = monthsFromTodayToRetirement;

    const totalRealAtRetirement = toRealDollars(
      totalNominalAtRetirement,
      vars.expectedInflation,
      yearsToRetirement
    );

    // --- Withdrawal schedule (v2, after-tax real targets) ---
    const schedule = buildWithdrawalSchedule({
      vars,
      anchors,
      retirementYear: vars.retirementYear,
      retirementBalances,
      tfsaRoomAtRetirement,
    });

    return {
      yearsToRetirement,
      monthsToRetirement,
      baselineTotal,
      monthlyTotal,
      accumulationSchedule,
      accumulationTimeline: accumulationTimelinePoints,
      retirementBalances,
      totalNominalAtRetirement,
      totalRealAtRetirement,
      tfsaRoomAtRetirement,
      todayPosition,
      schedule,
    };
  }, [vars, anchors, baselineTotal, monthlyTotal]);

  // One place that turns "year Y of the plan" into a set of tax inputs.
  //
  // This logic existed twice -- once on the Tax tab, once on Tax Brackets --
  // byte-for-byte identical apart from indentation. Two copies of a rule about
  // money is two chances to fix only one of them.
  const applyTaxYearFromSchedule = (year: number) => {
    setVars((v) => {
      const yearsFromBaseline = year - anchors.baselineYear;
      const indexRate = v.expectedInflation * v.cpiMultiplier;

      const indexNominal = (amountReal: number) =>
        v.dollarsMode === "real"
          ? amountReal
          : amountReal * Math.pow(1 + indexRate, Math.max(0, yearsFromBaseline));

      const inRetirement = year >= v.retirementYear;
      // Working income is a baseline-year figure; grow it to the year being taxed.
      const raise = incomeGrowthFactor({
        asOfYear: anchors.baselineYear,
        year,
        growthRate: v.incomeGrowthRate ?? 0.02,
      });
      const schedRow = inRetirement ? model.schedule.find((r) => r.year === year) : undefined;

      // In retirement years, take each person's pension, CPP, OAS (and the
      // retirement year's half-year of salary) straight from the withdrawal
      // engine, so the Tax tab taxes exactly what the plan pays. The local
      // estimates below are only a fallback for a year the schedule lacks;
      // they used to be the only source, and indexed Shingo's fixed pension
      // at CPI and Sarah's from 2026 rather than from retirement.
      const d = schedRow?.incomeDetail;
      const pensionShingo = d ? d.pensionShingo : anchors.pensionShingo;
      const pensionSarah = d ? d.pensionSarah : projectedPensionSarah(anchors, v);

      const ageShingo = year - anchors.shingoBirthYear;
      const ageSarah = year - anchors.sarahBirthYear;

      const cppShingo = d ? d.cppShingo : ageShingo >= v.cppStartAge ? indexNominal(v.withdrawals.cppShingoAnnual) : 0;
      const cppSarah = d ? d.cppSarah : ageSarah >= v.cppStartAge ? indexNominal(v.withdrawals.cppSarahAnnual) : 0;
      const oasShingo = d ? d.oasShingo : ageShingo >= v.oasStartAge ? indexNominal(v.withdrawals.oasShingoAnnual) : 0;
      const oasSarah = d ? d.oasSarah : ageSarah >= v.oasStartAge ? indexNominal(v.withdrawals.oasSarahAnnual) : 0;

      const rrifHousehold = schedRow ? schedRow.withdrawals.rrsp : 0;
      const lifShingo = schedRow ? schedRow.withdrawals.lira : 0;
      const tfsaHousehold = schedRow ? schedRow.withdrawals.tfsa : 0;

      // Split household withdrawals in proportion to who owns the balance,
      // not 50/50. RRSPs are registered per person and tax is assessed per
      // person, so halving a withdrawal between unequal accounts reports
      // income against a plan that does not hold it. Falls back to an even
      // split only when both balances are zero and there is nothing to weight.
      const share = (a: number, b: number) => {
        const total = a + b;
        return total > 0 ? a / total : 0.5;
      };
      const rrspShare = share(v.balances.rrspShingo, v.balances.rrspSarah);
      const tfsaShare = share(v.balances.tfsaShingo, v.balances.tfsaSarah);

      return {
        ...v,
        tax: {
          ...v.tax,
          taxYear: year,

          shingoEmployment: inRetirement ? (d?.employmentShingo ?? 0) : v.tax.workingIncomeShingo * raise,
          sarahEmployment: inRetirement ? (d?.employmentSarah ?? 0) : v.tax.workingIncomeSarah * raise,

          shingoPensionDb: inRetirement ? pensionShingo : 0,
          sarahPensionDb: inRetirement ? pensionSarah : 0,

          shingoCpp: inRetirement ? cppShingo : 0,
          sarahCpp: inRetirement ? cppSarah : 0,
          shingoOas: inRetirement ? oasShingo : 0,
          sarahOas: inRetirement ? oasSarah : 0,

          shingoRrif: inRetirement ? rrifHousehold * rrspShare : 0,
          sarahRrif: inRetirement ? rrifHousehold * (1 - rrspShare) : 0,

          // The LIRA/LIF is Shingo's alone.
          shingoLif: inRetirement ? lifShingo : 0,
          sarahLif: 0,

          shingoRrsp: 0,
          sarahRrsp: 0,

          shingoTfsa: inRetirement ? tfsaHousehold * tfsaShare : 0,
          sarahTfsa: inRetirement ? tfsaHousehold * (1 - tfsaShare) : 0,
        },
      };
    });
  };

  const orderOptions: WithdrawalOrder[] = [
    "fhsa",
    "rrsp",
    "lira",
    "nonRegistered",
    "tfsa",
  ];

  if (authLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 16, opacity: 0.6 }}>
        Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#f7f7f7" }}>
        <div style={{ background: "white", padding: 40, borderRadius: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.1)", maxWidth: 360, width: "100%" }}>
          <h2 style={{ margin: "0 0 24px", fontSize: 24, textAlign: "center" }}>Retirement Resource</h2>
          <form onSubmit={handleAuth} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{ padding: "12px 14px", fontSize: 16, borderRadius: 6, border: "1px solid #ddd" }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={{ padding: "12px 14px", fontSize: 16, borderRadius: 6, border: "1px solid #ddd" }}
            />
            {authError && <div style={{ color: "#dc2626", fontSize: 14 }}>{authError}</div>}
            <button type="submit" style={{ padding: "12px", fontSize: 16, borderRadius: 6, border: "none", background: "#2563eb", color: "white", cursor: "pointer", fontWeight: 600 }}>
              {isSignUp ? "Sign Up" : "Sign In"}
            </button>
          </form>
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            style={{ marginTop: 16, width: "100%", padding: 8, fontSize: 14, background: "none", border: "none", color: "#2563eb", cursor: "pointer" }}
          >
            {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
          </button>
          <button
            onClick={() => setUser({ id: "local" })}
            style={{ marginTop: 12, width: "100%", padding: 10, fontSize: 14, background: "#f3f4f6", border: "none", borderRadius: 6, color: "#374151", cursor: "pointer" }}
          >
            Continue without account
          </button>
        </div>
      </div>
    );
  }

  if (dbLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", fontSize: 16, opacity: 0.6 }}>
        Loading plan…
      </div>
    );
  }

  const timelineStart = anchors.baselineYear;
  // The plan runs until the YOUNGER spouse reaches the end age, so it ends when
  // Sarah turns 90, not Shingo. Read it off the schedule so the two can't drift.
  const lastScheduleRow = model.schedule[model.schedule.length - 1];
  const timelineEnd =
    lastScheduleRow?.year ??
    Math.max(anchors.shingoBirthYear, anchors.sarahBirthYear) + vars.phaseAges.endAge;
  const nowYear = new Date().getFullYear();
  const tlPct = (y: number) =>
    `${Math.max(0, Math.min(100, ((y - timelineStart) / (timelineEnd - timelineStart)) * 100)).toFixed(2)}%`;
  const retirePct  = tlPct(anchors.targetRetirementYear);
  const nowPct     = tlPct(nowYear);

  return (
    <>
    {/* ── Full-width gradient banner ── */}
    <div style={{
      background: "linear-gradient(135deg, #fbbf24 0%, #f97316 45%, #dc2626 100%)",
      color: "white",
    }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "36px 32px 32px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: "-0.5px" }}>
              Retirement Resource
            </h1>
            <p style={{ marginTop: 6, marginBottom: 32, opacity: 0.88, fontSize: 14, maxWidth: 520, lineHeight: 1.5 }}>
              Canada / BC retirement planner — adjust levers while keeping anchors explicit.
            </p>
          </div>
          {user && user.id !== "local" && (
            <button
              onClick={() => supabase.auth.signOut()}
              style={{ padding: "8px 16px", fontSize: 14, borderRadius: 6, border: "1px solid rgba(255,255,255,0.3)", background: "rgba(255,255,255,0.1)", color: "white", cursor: "pointer" }}
            >
              Sign Out
            </button>
          )}
        </div>

        {/* Timeline */}
        <div style={{ position: "relative", paddingBottom: 36 }}>
          {/* Track */}
          <div style={{
            height: 3,
            background: "rgba(255,255,255,0.25)",
            borderRadius: 99,
            position: "relative",
          }}>
            {/* Filled portion: start → now */}
            <div style={{
              position: "absolute",
              left: 0,
              width: nowPct,
              height: "100%",
              background: "rgba(255,255,255,0.75)",
              borderRadius: 99,
            }} />

            {/* Dot: Today */}
            <div style={{ position: "absolute", left: nowPct, top: "50%", transform: "translate(-50%, -50%)" }}>
              <div style={{
                width: 14, height: 14,
                borderRadius: "50%",
                background: "white",
                boxShadow: "0 0 0 3px rgba(255,255,255,0.4)",
              }} />
            </div>

            {/* Dot: Retire */}
            <div style={{ position: "absolute", left: retirePct, top: "50%", transform: "translate(-50%, -50%)" }}>
              <div style={{
                width: 10, height: 10,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.6)",
                border: "2px solid white",
              }} />
            </div>

            {/* Dot: End */}
            <div style={{ position: "absolute", left: "100%", top: "50%", transform: "translate(-50%, -50%)" }}>
              <div style={{
                width: 10, height: 10,
                borderRadius: "50%",
                background: "rgba(255,255,255,0.4)",
                border: "2px solid rgba(255,255,255,0.7)",
              }} />
            </div>
          </div>

          {/* Labels */}
          <div style={{ position: "absolute", left: nowPct, top: 14, transform: "translateX(-50%)", textAlign: "center", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{nowYear}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Today</div>
          </div>
          <div style={{ position: "absolute", left: retirePct, top: 14, transform: "translateX(-50%)", textAlign: "center", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{anchors.targetRetirementYear}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>Retire</div>
          </div>
          <div style={{ position: "absolute", left: "100%", top: 14, transform: "translateX(-50%)", textAlign: "center", whiteSpace: "nowrap" }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{timelineEnd}</div>
            <div style={{ fontSize: 11, opacity: 0.75 }}>
              Plan ends{lastScheduleRow ? ` · Sarah ${lastScheduleRow.ageSarah}` : ""}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      className="app"
      style={{
        width: "100%",
        maxWidth: 1080,
        margin: "0 auto",
        padding: 24,
      }}
    >

      <nav
        className="card"
        style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          display: "flex",
          gap: 0,
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px",
        }}
      >
        <div style={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
          {(
            [
              { id: "overview",     label: "Overview" },
              { id: "current",      label: "Current" },
              { id: "tax",          label: "Tax" },
              { id: "withdrawals",  label: "Withdrawals" },
            ] as { id: typeof page; label: string }[]
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className="tabBtn"
              onClick={() => setPage(id)}
              data-active={page === id}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
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
          <button
            type="button"
            onClick={() => { setAnchors(DEFAULT_ANCHORS); setVars(DEFAULT_VARIABLES); }}
            style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
            title="Reset all inputs back to the starting snapshot and default assumptions"
          >
            Reset
          </button>
        </div>
      </nav>

      {saveErrors.length > 0 && (
        <div style={{ margin: "0 0 12px", padding: "10px 12px", borderRadius: 10, fontSize: 13, background: "#fee2e2", border: "1px solid #fca5a5" }}>
          <strong>Your changes are not being saved.</strong>{" "}
          {saveErrors.length === 1 ? "One statement failed" : `${saveErrors.length} statements failed`}:
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {saveErrors.map((e, i) => (
              <li key={i}><code>{e.what}</code> — {e.message}</li>
            ))}
          </ul>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        {page === "overview" && (
        <>
        <section id="retirementTiming" className="card">
          <h2>Retirement timing</h2>
          {(() => {
            const shingoAge = vars.retirementYear - anchors.shingoBirthYear;
            const sarahAge = vars.retirementYear - anchors.sarahBirthYear;
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
                          shingoRetireAge: year - anchors.shingoBirthYear,
                          sarahRetireAge: year - anchors.sarahBirthYear,
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
            <Field label="Indexation (CPI multiplier)">
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
            <Field label="Non-registered tax drag (%/yr)">
              <PercentInput
                value={vars.nonRegTaxDragRate ?? 0}
                step={0.05}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, nonRegTaxDragRate: rate }))
                }
              />
            </Field>
            <Field label="Expected nominal return (%/yr)">
              <PercentInput
                value={vars.expectedNominalReturn}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, expectedNominalReturn: rate }))
                }
              />
            </Field>
            <Field label="Expected inflation (%/yr)">
              <PercentInput
                value={vars.expectedInflation}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, expectedInflation: rate }))
                }
              />
            </Field>
            <Field label="Salary growth (%/yr, working years)">
              <PercentInput
                value={vars.incomeGrowthRate ?? 0.02}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, incomeGrowthRate: rate }))
                }
              />
            </Field>
          </div>

          <div className="settingsRow">
            <SettingsButton
              label="FHSA caps & contributions"
              summary={`$${money(vars.fhsa.lifetimeCap)} lifetime cap · room left: Shingo $${money(
                Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo)
              )}, Sarah $${money(
                Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah)
              )}`}
              onClick={() => setSettingsPanel("fhsa")}
            />
          </div>

          <Modal
            open={settingsPanel === "fhsa"}
            title="FHSA caps & contributions"
            description="Statutory FHSA limits and how much each of you has already put in. When the FHSA is capped, the model redirects that monthly amount into the same person's RRSP."
            onClose={closeSettingsPanel}
          >
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
            <strong>${moneyY(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedShingo), anchors.baselineYear)}</strong>
            {" "} | Remaining FHSA room (Sarah):{" "}
            <strong>${moneyY(Math.max(0, vars.fhsa.lifetimeCap - vars.fhsa.contributedSarah), anchors.baselineYear)}</strong>
          </div>
          </Modal>
        </section>


        <section id="retirement-balances" className="card">
          <h2>Starting balances at retirement (projected, 1 July {vars.retirementYear})</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This is calculated by simulating contributions month-by-month from today to the end of June {vars.retirementYear},
            including FHSA annual/lifetime caps, redirecting capped FHSA contributions into RRSP, and anything the RRSP
            can't take into TFSA, then non-registered.
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
          {/* scroll navigation buttons removed */}
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
                    <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9", whiteSpace: "nowrap" }}>
                      {r.year}
                      {r.months < 12 ? (
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                          {r.year === vars.retirementYear ? `Jan–${["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][r.months]}` : `last ${r.months} mo`}
                        </div>
                      ) : null}
                    </td>
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
            Balances by account (stacked shading) + total line, from today to retirement. Year marks are 1 January.
            Uses the Dollars mode toggle.
          </div>
          <AccumulationGraph
            points={model.accumulationTimeline}
            adjustDollars={adjustDollars}
            formatMoney={money}
          />
        </section>

        </>
        )}

        {page === "current" && (
        <section id="current" className="card">
          <h2>Current snapshot</h2>
          {(() => {
            const today = new Date();
            const nowYear = today.getFullYear();
            const yearForDollars = nowYear;

            // Back-button: compute display balances from saved snapshot + contributions
            const snap = savedSnapshot;
            const snapDate = snap ? new Date(snap.asOf + "T00:00:00") : null;
            const fullMonthsElapsed = snapDate
              ? Math.max(0,
                  (today.getFullYear() - snapDate.getFullYear()) * 12 +
                  (today.getMonth() - snapDate.getMonth())
                )
              : 0;

            const displayBalances = showingSavedSnapshot && snap
              ? {
                  fhsaShingo:    snap.balances.fhsaShingo    + vars.monthly.fhsaShingo      * fullMonthsElapsed,
                  fhsaSarah:     snap.balances.fhsaSarah     + vars.monthly.fhsaSarah       * fullMonthsElapsed,
                  rrspShingo:    snap.balances.rrspShingo    + vars.monthly.rrspShingo      * fullMonthsElapsed,
                  rrspSarah:     snap.balances.rrspSarah     + vars.monthly.rrspSarah       * fullMonthsElapsed,
                  tfsaShingo:    snap.balances.tfsaShingo    + (vars.monthly.tfsaTotal / 2) * fullMonthsElapsed,
                  tfsaSarah:     snap.balances.tfsaSarah     + (vars.monthly.tfsaTotal / 2) * fullMonthsElapsed,
                  liraShingo:    snap.balances.liraShingo,
                  nonRegistered: snap.balances.nonRegistered,
                }
              : vars.balances;

            const displayDate = showingSavedSnapshot && snap ? snap.asOf : (vars.balancesAsOf ?? today.toISOString().slice(0, 10));

            // For "today" mode, grow the raw saved balances to today for the totals display.
            const savedDateForGrowth = vars.balancesAsOf ? new Date(vars.balancesAsOf + "T00:00:00") : null;
            const daysToToday = savedDateForGrowth
              ? Math.max(0, (today.getTime() - savedDateForGrowth.getTime()) / 86400000)
              : 0;
            const growthToToday = Math.pow(1 + vars.expectedNominalReturn, daysToToday / 365);
            const grow = showingSavedSnapshot ? (x: number) => x : (x: number) => x * growthToToday;

            const totals = {
              fhsa:   grow(displayBalances.fhsaShingo + displayBalances.fhsaSarah),
              rrsp:   grow(displayBalances.rrspShingo + displayBalances.rrspSarah),
              tfsa:   grow(displayBalances.tfsaShingo + displayBalances.tfsaSarah),
              lira:   grow(displayBalances.liraShingo),
              nonReg: grow(displayBalances.nonRegistered),
            };

            const grandTotal = totals.fhsa + totals.rrsp + totals.tfsa + totals.lira + totals.nonReg;

            return (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
                  <p style={{ marginTop: 0, marginBottom: 0, opacity: 0.85, fontSize: 13 }}>
                    {showingSavedSnapshot && snap
                      ? <>Last saved: <strong>{new Date(snap.asOf + "T00:00:00").toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong>{fullMonthsElapsed > 0 && <span style={{ opacity: 0.7 }}> + {fullMonthsElapsed} mo contributions</span>}</>
                      : <>Today's estimate: <strong>{today.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</strong> (interest applied)</>
                    }
                  </p>
                  {snap && (
                    <button
                      type="button"
                      onClick={() => setShowingSavedSnapshot((s) => !s)}
                      style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, border: "1px solid #cbd5e1", background: "white", cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {showingSavedSnapshot ? "→ Today's estimate" : "← Last saved"}
                    </button>
                  )}
                </div>

                {(() => {
                  // Every figure here comes from the SAME accumulation the
                  // Overview uses. This used to re-run its own copy of the
                  // monthly loop, which had fallen behind it: no refunds into
                  // the TFSA, no RRSP overflow, no new TFSA room after 2026,
                  // and it started from 1 January even though the balances are
                  // dated today. In 2036 it came out ~$66,000 below the Overview.
                  const rows = model.accumulationSchedule;
                  const lastRow = rows[rows.length - 1];
                  const AT_RETIREMENT = 0;

                  type Point = { key: number; label: string; note: string; dollarsYear: number; pos: AccumPosition };
                  const points: Point[] = [
                    {
                      key: nowYear,
                      label: "Today",
                      note: `Today's estimate (${today.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}): your balances grown to today, and your room as entered.`,
                      dollarsYear: nowYear,
                      pos: model.todayPosition,
                    },
                  ];
                  for (const r of rows) {
                    if (r.year > nowYear && r.startOfYear) {
                      points.push({
                        key: r.year,
                        label: `1 Jan ${r.year}`,
                        note: `Estimate for 1 January ${r.year}: after that year's new TFSA and RRSP room is added, before any ${r.year} contributions.`,
                        dollarsYear: r.year,
                        pos: r.startOfYear,
                      });
                    }
                  }
                  if (lastRow) {
                    points.push({
                      key: AT_RETIREMENT,
                      label: `Retirement (Jul ${vars.retirementYear})`,
                      note: `At retirement, 1 July ${vars.retirementYear}: the balances the withdrawal plan starts from.`,
                      dollarsYear: vars.retirementYear,
                      pos: lastRow.end,
                    });
                  }

                  const point = points.find((p) => p.key === currentSnapshotYear) ?? points[0]!;
                  const b = point.pos.balances;
                  const room = point.pos.room;
                  const year = point.dollarsYear;
                  const totals = {
                    fhsa: b.fhsaShingo + b.fhsaSarah,
                    rrsp: b.rrspShingo + b.rrspSarah,
                    tfsa: b.tfsaShingo + b.tfsaSarah,
                    lira: b.liraShingo,
                    nonReg: b.nonRegistered,
                  };
                  const grand = totals.fhsa + totals.rrsp + totals.tfsa + totals.lira + totals.nonReg;

                  return (
                    <div style={{ marginTop: 12, padding: 10, border: "1px solid #e5e7eb", background: "#f8fafc", borderRadius: 10 }}>
                      <div className="selectRow" style={{ marginTop: 0 }}>
                        <Field label="Snapshot">
                          <select
                            className="ageInput"
                            value={point.key}
                            onChange={(e) => setCurrentSnapshotYear(num(e.target.value))}
                            style={{ minWidth: 170, width: 170 }}
                          >
                            {points.map((p) => (
                              <option key={p.key} value={p.key}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "end", paddingBottom: 2 }}>
                          {point.note}
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
                        <div>TFSA room S: <strong>${moneyY(room.tfsaShingo, year)}</strong></div>
                        <div>TFSA room Sa: <strong>${moneyY(room.tfsaSarah, year)}</strong></div>
                        <div>RRSP room S: <strong>${moneyY(room.rrspShingo, year)}</strong></div>
                        <div>RRSP room Sa: <strong>${moneyY(room.rrspSarah, year)}</strong></div>
                        <div>FHSA room S: <strong>${moneyY(room.fhsaShingo, year)}</strong></div>
                        <div>FHSA room Sa: <strong>${moneyY(room.fhsaSarah, year)}</strong></div>
                      </div>

                      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
                        <div>Bal FHSA: <strong>${moneyY(totals.fhsa, year)}</strong></div>
                        <div>Bal RRSP: <strong>${moneyY(totals.rrsp, year)}</strong></div>
                        <div>Bal TFSA: <strong>${moneyY(totals.tfsa, year)}</strong></div>
                        <div>Bal LIRA: <strong>${moneyY(totals.lira, year)}</strong></div>
                        <div>Bal NonReg: <strong>${moneyY(totals.nonReg, year)}</strong></div>
                        <div>Total: <strong>${moneyY(grand, year)}</strong></div>
                      </div>
                    </div>
                  );
                })()}

                <div className="settingsRow">
                  <SettingsButton
                    label="Contribution room"
                    summary={`RRSP $${money(vars.rrspRoomShingo + vars.rrspRoomSarah)} · TFSA $${money(
                      vars.tfsaRoomShingo + vars.tfsaRoomSarah
                    )} household`}
                    onClick={() => setSettingsPanel("room")}
                  />
                </div>

                <Modal
                  open={settingsPanel === "room"}
                  title="Contribution room"
                  description="How much room each of you has left, and the figures that generate new room each year. These come off your Notice of Assessment and T4 — they change once a year, not once a session."
                  onClose={closeSettingsPanel}
                >
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

                  <Field label="Pension adjustment Shingo ($/yr)
(T4 box 52 — reduces RRSP room)">
                    <input
                      type="number"
                      value={vars.pensionAdjustmentShingo ?? 0}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          pensionAdjustmentShingo: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Pension adjustment Sarah ($/yr)
(T4 box 52 — reduces RRSP room)">
                    <input
                      type="number"
                      value={vars.pensionAdjustmentSarah ?? 0}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          pensionAdjustmentSarah: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP dollar limit ($, 2026)
(caps new room at 18% of income)">
                    <input
                      type="number"
                      value={vars.rrspDollarLimit ?? 33810}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          rrspDollarLimit: num(e.target.value),
                        }))
                      }
                    />
                  </Field>

                  <Field label="Earned income Shingo ($/yr)
(for new RRSP room)">
                    <input
                      className="moneyInputLg"
                      type="number"
                      value={vars.earnedIncomeShingo}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          earnedIncomeShingo: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Earned income Sarah ($/yr)
(for new RRSP room)">
                    <input
                      className="moneyInputLg"
                      type="number"
                      value={vars.earnedIncomeSarah}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          earnedIncomeSarah: num(e.target.value),
                        }))
                      }
                    />
                  </Field>
                  <div style={{ fontSize: 12, opacity: 0.75, maxWidth: 260 }}>
                    Salary growth is set on the Overview tab under
                    Expectations. It grows these earned-income figures, and
                    with them this room projection, the working-year salary in
                    the Tax tab, and the projected starting amount of the BC
                    Teachers&rsquo; Pension.
                  </div>
                </div>
                </Modal>


                <h3 style={{ marginTop: 14 }}>Current balances {showingSavedSnapshot ? "(last saved)" : "(editable)"}</h3>
                <div style={{ marginBottom: 10 }}>
                  <Field label="Balances as of">
                    <input
                      type="date"
                      value={displayDate}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) => {
                        const newDate = e.target.value;
                        if (!newDate) {
                          setVars((v) => ({ ...v, balancesAsOf: newDate }));
                          return;
                        }
                        const newBalances = calculateBalancesToDate({
                          baselineYear: anchors.baselineYear,
                          baselineBalances: vars.balances,
                          targetDateStr: newDate,
                          annualReturn: vars.expectedNominalReturn,
                          fhsaContributedToDateShingo: vars.fhsa.contributedShingo,
                          fhsaContributedToDateSarah: vars.fhsa.contributedSarah,
                          fhsaAnnualLimit: vars.fhsa.annualLimit,
                          fhsaLifetimeCap: vars.fhsa.lifetimeCap,
                          monthlyFhsaShingo: vars.monthly.fhsaShingo,
                          monthlyFhsaSarah: vars.monthly.fhsaSarah,
                          monthlyRrspShingo: vars.monthly.rrspShingo,
                          monthlyRrspSarah: vars.monthly.rrspSarah,
                          monthlyTfsaTotal: vars.monthly.tfsaTotal,
                          nonRegTaxDragRate: vars.nonRegTaxDragRate ?? 0,
                        });
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: newDate,
                          balances: newBalances,
                        }));
                      }}
                    />
                  </Field>
                </div>
                <div className="tightGrid">
                  <Field label="FHSA Shingo (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.fhsaShingo}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, fhsaShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="FHSA Sarah (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.fhsaSarah}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, fhsaSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Shingo (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.rrspShingo}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, rrspShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="RRSP Sarah (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.rrspSarah}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, rrspSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA Shingo (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.tfsaShingo}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, tfsaShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="TFSA Sarah (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.tfsaSarah}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, tfsaSarah: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, gridColumn: "1 / -1", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={vars.tfsaIncludesRefund ?? false}
                      onChange={(e) => setVars((v) => ({ ...v, tfsaIncludesRefund: e.target.checked }))}
                    />
                    TFSA amounts above already include the tax refund deposit — don't project additional refund→TFSA in the accumulation model
                  </label>
                  <Field label="LIRA/LIF Shingo (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.liraShingo}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, liraShingo: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Non-registered (starting, $)">
                    <input
                      type="number"
                      value={displayBalances.nonRegistered}
                      readOnly={showingSavedSnapshot}
                      onChange={(e) =>
                        setVars((v) => ({
                          ...v,
                          balancesAsOf: new Date().toISOString().slice(0, 10),
                          balances: { ...v.balances, nonRegistered: num(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                </div>

                <div className="settingsRow">
                  <SettingsButton
                    label="Monthly contributions"
                    summary={`$${money(
                      (vars.monthly.fhsaShingo +
                        vars.monthly.fhsaSarah +
                        vars.monthly.rrspShingo +
                        vars.monthly.rrspSarah +
                        vars.monthly.tfsaTotal) * 12
                    )}/yr household`}
                    onClick={() => setSettingsPanel("monthly")}
                  />
                </div>

                <Modal
                  open={settingsPanel === "monthly"}
                  title="Monthly contributions"
                  description="What goes in each month, per account. Change these when your payroll or automatic transfers change."
                  onClose={closeSettingsPanel}
                >
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
                </Modal>


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
            const shingoAge = vars.tax.taxYear - anchors.shingoBirthYear;
            const sarahAge = vars.tax.taxYear - anchors.sarahBirthYear;

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
              // Without this the engine falls back to DEFAULT_TAX_INDEXATION
              // while the bracket chart directly below uses your own expected
              // inflation -- two different bracket tables on one screen, and a
              // splitting optimum solved against thresholds nobody is looking at.
              annualInflation: vars.expectedInflation,
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
                      onChange={(e) => applyTaxYearFromSchedule(num(e.target.value))}
                      style={{ maxWidth: 110 }}
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


                <h3 style={{ marginTop: 14 }}>Where this lands in the brackets</h3>
                {(() => {
                  const bt = getBracketTableForYear({
                    taxYear: vars.tax.taxYear,
                    annualInflation: vars.expectedInflation,
                  });
                  const FED = bt.federal.brackets;
                  const BC = bt.bc.brackets;
                  const bracketNote =
                    bt.baseYear === vars.tax.taxYear
                      ? `Using ${vars.tax.taxYear} tables.`
                      : `Thresholds inflated from ${bt.baseYear} using expected inflation; rates assumed constant.`;

            const findBracket = (income: number, brackets: Array<{ upTo: number; rate: number }>) => {
              const x = Math.max(0, income);
              let prev = 0;
              for (let i = 0; i < brackets.length; i++) {
                const b = brackets[i];
                if (x <= b.upTo) {
                  return {
                    index: i,
                    rate: b.rate,
                    from: prev,
                    to: b.upTo,
                    nextTo: brackets[i + 1]?.upTo ?? Infinity,
                  };
                }
                prev = b.upTo;
              }
              const last = brackets[brackets.length - 1];
              return { index: brackets.length - 1, rate: last.rate, from: prev, to: Infinity, nextTo: Infinity };
            };

            const renderBar = (title: string, brackets: Array<{ upTo: number; rate: number }>, activeIdx: number, palette: string[]) => {
              const finiteMax = Math.max(...brackets.filter((b) => Number.isFinite(b.upTo)).map((b) => b.upTo));
              const max = finiteMax;
              let prev = 0;
              return (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>{title}</div>
                  <div style={{ display: "flex", width: "100%", border: "1px solid #e5e7eb", borderRadius: 10, overflow: "hidden", height: 28 }}>
                    {brackets.map((b, i) => {
                      const to = Number.isFinite(b.upTo) ? b.upTo : max;
                      const w = ((to - prev) / max) * 100;
                      const from = prev;
                      prev = Number.isFinite(b.upTo) ? b.upTo : prev;
                      const bg = palette[i % palette.length];
                      return (
                        <div
                          key={`${title}-${i}`}
                          title={`${moneyY(from, vars.tax.taxYear)} – ${Number.isFinite(b.upTo) ? moneyY(b.upTo, vars.tax.taxYear) : "∞"} @ ${(b.rate * 100).toFixed(2)}%`}
                          style={{
                            width: `${Math.max(2, w)}%`,
                            background: bg,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 11,
                            color: "#0f172a",
                            fontWeight: i === activeIdx ? 700 : 500,
                            outline: i === activeIdx ? "2px solid #0f172a" : "none",
                            outlineOffset: -2,
                          }}
                        >
                          {(b.rate * 100).toFixed(1)}%
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            };

                  return (
                    <>
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2 }}>{bracketNote}</div>
                      {([
                        { label: "Shingo", r: res.spouseA },
                        { label: "Sarah", r: res.spouseB },
                      ] as const).map(({ label, r }) => {
                        const income = r.taxableIncome;
                        const fedB = findBracket(income, FED);
                        const bcB = findBracket(income, BC);
                        const marginal = fedB.rate + bcB.rate;
                        const effective = income > 0 ? r.totalTax / income : 0;
                        const roomToNext = Math.min(
                          Number.isFinite(fedB.to) ? Math.max(0, fedB.to - income) : Infinity,
                          Number.isFinite(bcB.to) ? Math.max(0, bcB.to - income) : Infinity
                        );
                        return (
                          <div key={label} style={{ marginTop: 16 }}>
                            <h4 style={{ margin: "0 0 2px 0" }}>
                              {label} — taxable income ${moneyY(income, vars.tax.taxYear)}
                            </h4>
                            {renderBar(`${label} · Federal`, FED, fedB.index, ["#bae6fd", "#93c5fd", "#a7f3d0", "#fde68a", "#fecaca"])}
                            {renderBar(`${label} · BC`, BC, bcB.index, ["#ddd6fe", "#c4b5fd", "#a5b4fc", "#fbcfe8", "#bbf7d0", "#fed7aa", "#bae6fd"])}
                            <ul style={{ marginTop: 8, marginBottom: 0 }}>
                              <li>
                                Marginal rate: <strong>{(marginal * 100).toFixed(2)}%</strong> (Fed{" "}
                                {(fedB.rate * 100).toFixed(2)}% + BC {(bcB.rate * 100).toFixed(2)}%)
                              </li>
                              <li>
                                Effective rate: <strong>{(effective * 100).toFixed(2)}%</strong>
                              </li>
                              <li>
                                Room to next bracket:{" "}
                                <strong>
                                  {roomToNext === Infinity ? "—" : `$${moneyY(roomToNext, vars.tax.taxYear)}`}
                                </strong>
                              </li>
                            </ul>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}>Debug</summary>
                  <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, background: "#f8fafc", border: "1px solid #e5e7eb", padding: 10, borderRadius: 10, marginTop: 8 }}>
                    {JSON.stringify(res.debug, null, 2)}
                  </pre>
                </details>

                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer" }}>Working-year refund model (separate)</summary>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
                    RRSP/FHSA refund is assumed to be invested in TFSA each year.
                    Controlled by the "includes tax refund" checkbox on the Current page.
                    Retirement years do not include withholding/refunds.
                  </div>
                  <div className="selectRow" style={{ marginTop: 8 }}>
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
          <h2>Withdrawal schedule (after-tax targets, tax v2)</h2>
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

          </div>

          <div className="settingsRow">
            <SettingsButton
              label="Drawdown order"
              summary={vars.withdrawals.order.join(" → ")}
              onClick={() => setSettingsPanel("order")}
            />
            <SettingsButton
              label="Account handling"
              summary={`${
                vars.withdrawals.rollFhsaIntoRrspAtRetirement
                  ? "FHSA rolls into RRSP"
                  : "FHSA kept separate"
              } · TFSA room $${money(model.tfsaRoomAtRetirement)}`}
              onClick={() => setSettingsPanel("accounts")}
            />
            <SettingsButton
              label="LIF / RRIF settings"
              summary={`LIF ${vars.withdrawals.lifMode} · RRIF depleted by ${vars.withdrawals.rrifDepleteByAge}`}
              onClick={() => setSettingsPanel("lif")}
            />
            <SettingsButton
              label="Withdrawal caps"
              summary={(() => {
                const set = Object.values(vars.withdrawals.caps).filter((c) => c > 0).length;
                return set === 0 ? "None — no account is capped" : `${set} of 5 capped`;
              })()}
              onClick={() => setSettingsPanel("caps")}
            />
          </div>

          <Modal
            open={settingsPanel === "order"}
            title="Drawdown order"
            description="Which account is drawn down first when a year needs more cash than income provides. Choosing an account for one slot pushes the others down."
            onClose={closeSettingsPanel}
          >
            <div className="selectRow">
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
          </Modal>

          <Modal
            open={settingsPanel === "accounts"}
            title="Account handling"
            description="What happens to the FHSA at retirement, and where surplus cash goes once it has been withdrawn."
            onClose={closeSettingsPanel}
          >
          <div className="selectRow">
            <Field label="FHSA → RRSP handling">
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 0, marginBottom: 6 }}>
                If “Yes”, FHSA is rolled into RRSP at retirement. If “No”, FHSA is kept separate but forced to roll into RRSP after 15 years (Shingo FHSA start year 2024).
              </div>
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

            <div style={{ fontSize: 13, alignSelf: "end", lineHeight: 1.5 }}>
              TFSA room at retirement (household):{" "}
              <strong>${moneyY(model.tfsaRoomAtRetirement, vars.retirementYear)}</strong>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                Worked out from your room today, the new room each January (the TFSA limit
                indexed to inflation, rounded to $500 as CRA does) and everything the plan puts
                in before you retire. Surplus cash in retirement goes into the TFSA until the
                room is used up, then to non-registered. New room keeps arriving each January.
              </div>
            </div>
          </div>
          </Modal>

          <Modal
            open={settingsPanel === "lif"}
            title="LIF / RRIF settings"
            description="BC LIF withdrawal mode and how aggressively the RRIF is drawn down. These change the shape of the withdrawal curve, not the totals available."
            onClose={closeSettingsPanel}
          >
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
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
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

                <button
                  className="btnSmall"
                  type="button"
                  onClick={() => {
                    // Age-based search; objective: minimize total OAS clawback, tie-breaker: minimize total tax.
                    const minAge = Math.max(71, Math.min(95, Math.floor(vars.withdrawals.rrifDepleteByAge - 10)));
                    const maxAge = Math.max(minAge, Math.min(95, Math.floor(vars.withdrawals.rrifDepleteByAge + 10)));

                    let bestAge = vars.withdrawals.rrifDepleteByAge;
                    let bestClaw = Number.POSITIVE_INFINITY;
                    let bestTax = Number.POSITIVE_INFINITY;

                    for (let age = minAge; age <= maxAge; age++) {
                      const testVars: Variables = {
                        ...vars,
                        withdrawals: {
                          ...vars.withdrawals,
                          rrifDepleteByAge: age,
                        },
                      };

                      const sched = buildWithdrawalSchedule({
                        vars: testVars,
                        anchors,
                        retirementYear: testVars.retirementYear,
                        retirementBalances: model.retirementBalances,
                      });

                      const totalClaw = sched.reduce((sum, r) => sum + (r.debug.oasClawbackShingo + r.debug.oasClawbackSarah), 0);
                      const totalTax = sched.reduce((sum, r) => sum + r.debug.tax, 0);

                      if (
                        totalClaw < bestClaw - 1e-6 ||
                        (Math.abs(totalClaw - bestClaw) <= 1e-6 && totalTax < bestTax - 1e-6)
                      ) {
                        bestAge = age;
                        bestClaw = totalClaw;
                        bestTax = totalTax;
                      }
                    }

                    setSuggestedRrifDepleteByAge(bestAge);
                    setSuggestedRrifInfo(
                      `Suggest ${bestAge} (total clawback $${money(bestClaw)}, total tax $${money(bestTax)}; search ${minAge}–${maxAge}).`
                    );
                  }}
                >
                  Suggest
                </button>

                {suggestedRrifDepleteByAge != null && suggestedRrifDepleteByAge !== vars.withdrawals.rrifDepleteByAge ? (
                  <button
                    className="btnSmall"
                    type="button"
                    onClick={() =>
                      setVars((v) => ({
                        ...v,
                        withdrawals: {
                          ...v.withdrawals,
                          rrifDepleteByAge: suggestedRrifDepleteByAge,
                        },
                      }))
                    }
                  >
                    Apply
                  </button>
                ) : null}
              </div>

              {suggestedRrifInfo ? (
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{suggestedRrifInfo}</div>
              ) : null}
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

            <Field label="RRIF min rate multiplier">
              <input
                className="compactNumber"
                type="number"
                step="0.1"
                min={0}
                value={vars.withdrawals.rrifMinMultiplier}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      rrifMinMultiplier: Math.max(0, num(e.target.value)),
                    },
                  }))
                }
              />
            </Field>

            <Field label={"Avoid OAS clawback\n(shift RRSP→TFSA/NonReg)"}>
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

            <Field label={"Force LIF withdrawals\n(starting at retirement)"}>
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
          </Modal>

          <Modal
            open={settingsPanel === "caps"}
            title="Withdrawal caps"
            description="A yearly ceiling on what may come out of each account, in dollars. Leave a cap at 0 to place no limit on that account."
            onClose={closeSettingsPanel}
          >
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
          </Modal>


          <div className="settingsRow">
            <SettingsButton
              label="Employer pensions"
              summary={`Shingo $${money(anchors.pensionShingo)}/yr · Sarah $${money(
                projectedPensionSarah(anchors, vars)
              )}/yr with raises`}
              onClick={() => setSettingsPanel("pensions")}
            />
            <SettingsButton
              label="CPP & OAS"
              summary={`CPP $${money(
                vars.withdrawals.cppShingoAnnual + vars.withdrawals.cppSarahAnnual
              )} · OAS $${money(
                vars.withdrawals.oasShingoAnnual + vars.withdrawals.oasSarahAnnual
              )} household at 70`}
              onClick={() => setSettingsPanel("benefits")}
            />
          </div>

          <Modal
            open={settingsPanel === "pensions"}
            title="Employer pensions"
            description="Annual amount at retirement, and how it grows once being paid."
            onClose={closeSettingsPanel}
          >
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
            Annual amount at retirement, and how it grows once it is being paid.
            Indexation is <strong>not</strong> the salary-increase assumption a pension
            calculator uses to project the starting amount — enter 0 for a plan that
            pays a fixed cheque for life.
          </div>
          <div className="selectRow">
            <Field label="Pension Shingo ($/yr)">
              <input
                className="moneyInputMd"
                type="number"
                value={anchors.pensionShingo}
                onChange={(e) =>
                  setAnchors((a) => ({ ...a, pensionShingo: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="Indexation Shingo (%/yr)">
              <PercentInput
                value={vars.pensionIndexRateShingo ?? vars.pensionIndexRate}
                step={0.25}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, pensionIndexRateShingo: rate }))
                }
              />
            </Field>
            <Field
              label={`Pension Sarah ($/yr, ${PENSION_SARAH_STATEMENT_YEAR} statement)
$${money(projectedPensionSarah(anchors, vars))} with raises`}
            >
              <input
                className="moneyInputMd"
                type="number"
                value={anchors.pensionSarah}
                onChange={(e) =>
                  setAnchors((a) => ({ ...a, pensionSarah: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="Indexation Sarah (%/yr)">
              <PercentInput
                value={vars.pensionIndexRateSarah ?? vars.pensionIndexRate}
                step={0.25}
                onChange={(rate) =>
                  setVars((v) => ({ ...v, pensionIndexRateSarah: rate }))
                }
              />
            </Field>
          </div>
          </Modal>


          <Modal
            open={settingsPanel === "benefits"}
            title="CPP & OAS"
            description="Amounts payable at age 70. Change these when a Service Canada statement arrives, not while planning — the model derives every other start age from them."
            onClose={closeSettingsPanel}
          >
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
            Enter the amounts payable <strong>at age 70</strong>. If you choose an earlier
            start age, the model applies the real actuarial reduction
            (CPP &minus;0.6%/month before 65, +0.7%/month after; OAS +0.6%/month after 65).
          </div>
          <div className="selectRow">
            <Field label="CPP Shingo ($/yr at age 70)">
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
            <Field label="CPP Sarah ($/yr at age 70)">
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
            <Field label="OAS Shingo ($/yr at age 70)">
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
            <Field label="OAS Sarah ($/yr at age 70)">
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
          </Modal>


          <h3 style={{ marginTop: 14 }}>Schedule</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start", marginTop: 6 }}>
            <label style={{ display: "inline-flex", gap: 8, alignItems: "center", fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>
              <input
                type="checkbox"
                checked={showFullSchedule}
                onChange={(e) => setShowFullSchedule(e.target.checked)}
              />
              Show full schedule
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {Object.keys(vars.withdrawals.rrspExtraByYear ?? {}).length > 0 && (
              <button
                className="btnSmall"
                type="button"
                onClick={() =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: { ...v.withdrawals, rrspExtraByYear: {} },
                  }))
                }
              >
                Clear (auto)
              </button>
            )}
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
            Note: Sarah’s CPP/OAS begins when <strong>she</strong> reaches the selected start age (e.g. 70),
            which is typically ~2 years after Shingo given your birth years.
          </div>

          {/* OAS clawback warning removed */}
          {/* scroll navigation buttons removed */}
          {(() => {
            const visibleRows = showFullSchedule ? model.schedule : model.schedule.slice(0, 12);
            const last = visibleRows[visibleRows.length - 1];

            const endTotal = last
              ? last.endBalances.fhsa +
                last.endBalances.rrsp +
                last.endBalances.lira +
                last.endBalances.tfsa +
                last.endBalances.nonRegistered
              : 0;

            return (
              <>
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
                          ["Spend", "after-tax"],
                          ["Pension", "$/yr"],
                          ["CPP+OAS", "$/yr"],
                          ["W/d", "RRSP"],
                          ["Extra", "RRSP"],
                          ["W/d", "LIF"],
                          // (removed W/d TFSA)
                          // (removed W/d NonReg)
                          ["Tax", "$/yr"],
                          ["After-tax", "cash"],
                          ["Surplus", "after-tax"],
                          ["Taxable", "max"],
                          ["OAS claw", "$/yr"],
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
                      {visibleRows.map((r) => {
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
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.targetAfterTaxSpending, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.guaranteedIncome, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.benefitsIncome, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.withdrawals.rrsp, r.year)}</td>
                            <td style={{ padding: "2px 4px", borderBottom: "1px solid #f1f5f9" }}>
                              <input
                                type="number"
                                step="1000"
                                min={0}
                                placeholder="auto"
                                value={vars.withdrawals.rrspExtraByYear?.[String(r.year)] ?? ""}
                                style={{ width: 80, fontSize: 12, textAlign: "right", padding: "2px 4px", border: "1px solid #d1d5db", borderRadius: 4, background: vars.withdrawals.rrspExtraByYear?.[String(r.year)] != null ? "#fffbeb" : undefined }}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  setVars((v) => {
                                    const prev = { ...(v.withdrawals.rrspExtraByYear ?? {}) };
                                    if (raw === "" || raw === "0") {
                                      delete prev[String(r.year)];
                                    } else {
                                      prev[String(r.year)] = Math.max(0, Number(raw));
                                    }
                                    return { ...v, withdrawals: { ...v.withdrawals, rrspExtraByYear: prev } };
                                  });
                                }}
                              />
                            </td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.withdrawals.lira, r.year)}</td>
                            {/* removed W/d TFSA */}
                            {/* removed W/d NonReg */}
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.debug.tax, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.debug.afterTaxCashAvailable, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.debug.surplusAfterTax, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(Math.max(r.debug.taxableIncomeShingo, r.debug.taxableIncomeSarah), r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(r.debug.oasClawbackShingo + r.debug.oasClawbackSarah, r.year)}</td>
                            <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${moneyY(endTotal, r.year)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {(model.schedule[0]?.debug.rrspLeftAtDepletion ?? 0) > 1000 && (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 10, fontSize: 12, background: "#fef3c7", border: "1px solid #fcd34d" }}>
                    <strong>This plan cannot be fully levelled by your target age.</strong>{" "}
                    About ${money(Math.round(model.schedule[0]!.debug.rrspLeftAtDepletion))} of
                    RRSP is still left at the depletion year, so that year takes a lump and
                    pays more tax and OAS clawback than the years around it. Try a later
                    “RRIF deplete by age”, or set per-year Extra RRSP amounts.
                  </div>
                )}

                {last ? (
                  <div style={{ marginTop: 10, padding: 10, border: "1px solid #e5e7eb", background: "#f8fafc", borderRadius: 10, fontSize: 12 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      Remaining balances after {last.year} (last visible row)
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                      <div>RRSP: <strong>${moneyY(last.endBalances.rrsp, last.year)}</strong></div>
                      <div>LIF: <strong>${moneyY(last.endBalances.lira, last.year)}</strong></div>
                      <div>TFSA: <strong>${moneyY(last.endBalances.tfsa, last.year)}</strong></div>
                      <div>NonReg: <strong>${moneyY(last.endBalances.nonRegistered, last.year)}</strong></div>
                      <div>Total: <strong>${moneyY(endTotal, last.year)}</strong></div>
                    </div>
                  </div>
                ) : null}
              </>
            );
          })()}

          <WithdrawalStrategies
            params={{
              vars,
              anchors,
              retirementYear: vars.retirementYear,
              retirementBalances: model.retirementBalances,
              tfsaRoomAtRetirement: model.tfsaRoomAtRetirement,
            }}
            real={vars.dollarsMode === "real"}
            onChangeDepleteAge={(age) =>
              setVars((v) => ({
                ...v,
                withdrawals: { ...v.withdrawals, rrifDepleteByAge: age },
              }))
            }
          />
        </section>
        )}
      </div>

      <footer style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        <div>
          Note: withdrawal schedule includes a simplified tax estimate and remains approximate.
        </div>
      </footer>
    </div>
    </>
  );
}
