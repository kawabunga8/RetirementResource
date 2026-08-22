export type PhaseSpending = {
  goGo: number;
  slowGo: number;
  noGo: number;
};

export type PhaseAges = {
  goGoEndAge: number; // inclusive end age
  slowGoEndAge: number;
  endAge: number;
};

export type Anchors = {
  location: string;
  targetRetirementYear: number;
  baselineYear: number;

  // Demographic anchors
  shingoBirthYear: number;
  sarahBirthYear: number;

  // Guaranteed / quasi-guaranteed income (annual, real/indexed)
  pensionShingo: number;
  pensionSarah: number;

  // Benefit assumptions (simple placeholders for now)
  cppShingoAt70Monthly: number;
  cppAssumedSarahAt70Monthly?: number;
};

export type AccountBalances = {
  // Tax-advantaged
  fhsaShingo: number;
  fhsaSarah: number;
  rrspShingo: number;
  rrspSarah: number;
  tfsaShingo: number;
  tfsaSarah: number;

  // Locked-in
  liraShingo: number;

  // Other
  nonRegistered: number;
};

export type MonthlyContributions = {
  // Note: simplified. Later we’ll add annual limits and redirection logic.
  tfsaTotal: number;
  fhsaShingo: number;
  fhsaSarah: number;
  rrspShingo: number;
  rrspSarah: number;
};

export type WithdrawalOrder =
  | "pension" // (not actually a withdrawal; included for narrative)
  | "fhsa"
  | "rrsp"
  | "lira"
  | "tfsa"
  | "nonRegistered";

export type LifMode = "min" | "mid" | "max";

export type WithdrawalPlan = {
  // In v1 we fill the annual income gap using this priority order.
  order: WithdrawalOrder[];

  // If true, try to keep individual taxable income below the (rough) OAS clawback threshold
  // by shifting RRSP/RRIF withdrawals to TFSA/non-registered where possible.
  avoidOasClawback: boolean;

  // RRIF depletion behavior
  // 0 = even amortization, 1 = strongly front-loaded
  rrifFrontLoad: number;

  // Multiplier applied to the RRIF minimum withdrawal rate table.
  // 1 = CRA minimums, 0.5 = half-min (planning), 2 = double-min.
  rrifMinMultiplier: number;

  // Retirement handling
  rollFhsaIntoRrspAtRetirement: boolean;

  // Surplus routing (forced RRIF, etc.)
  // How much TFSA contribution room you expect to have available at retirement (household).
  tfsaRoomAtRetirement: number;

  // New TFSA room created each year during retirement (household)
  tfsaNewRoomPerYear: number;

  // Annual caps (0 = no cap)
  // NOTE: LIRA/LIF is special: cap can be calculated from balance using lifMode.
  caps: {
    fhsa: number;
    rrsp: number;
    lira: number;
    tfsa: number;
    nonRegistered: number;
  };

  // LIF behavior (BC): min/mid/max option (v1 uses a simplified approximation).
  lifMode: LifMode;

  // If true, withdraw the LIF amount each year starting at retirement (even if not needed for spending).
  forceLifFromRetirement: boolean;

  // RRIF depletion target (age)
  rrifDepleteByAge: number;

  // Optional: treat TFSA as “preserve unless needed”
  allowTfsa: boolean;

  // Simple benefit placeholders (annual, can be 0)
  cppShingoAnnual: number;
  cppSarahAnnual: number;
  oasShingoAnnual: number;
  oasSarahAnnual: number;

  // Per-year extra RRSP overlay (year string → nominal $).
  // When non-empty, bypasses the binary-search glidepath entirely.
  // Keys are calendar year strings, e.g. "2037": 20000.
  rrspExtraByYear: Record<string, number>;
};

export type TaxInputs = {
  // Tax year for credits/age-related features
  taxYear: number;

  // UI toggles
  useBpa: boolean;
  useAgeAmount: boolean;
  usePensionCredit: boolean;
  enablePensionSplitting: boolean;

  // Explicit income inputs by source (planning estimator)
  shingoEmployment: number;
  sarahEmployment: number;

  shingoPensionDb: number;
  sarahPensionDb: number;

  shingoRrif: number;
  sarahRrif: number;

  shingoLif: number;
  sarahLif: number;

  shingoRrsp: number;
  sarahRrsp: number;

  shingoCpp: number;
  sarahCpp: number;

  shingoOas: number;
  sarahOas: number;

  shingoTfsa: number;
  sarahTfsa: number;

  // Refund modeling (working years only)
  // Refund is always assumed invested in TFSA; see tfsaIncludesRefund on Variables.
  workingIncomeShingo: number;
  workingIncomeSarah: number;
};

export type FhsaInputs = {
  annualLimit: number; // per person
  lifetimeCap: number; // per person
  contributedShingo: number;
  contributedSarah: number;
};

export type Variables = {
  // Display mode
  dollarsMode: "nominal" | "real";

  // Indexation (annual). Used for pensions/CPP/OAS.
  // "Partial CPI" means indexationRate = cpiMultiplier * expectedInflation
  cpiMultiplier: number; // e.g. 0.7 means 70% of CPI

  // Contribution room snapshot (as-of baselineYear)
  tfsaRoomShingo: number;
  tfsaRoomSarah: number;
  rrspRoomShingo: number;
  rrspRoomSarah: number;

  // Working-year assumptions (for new RRSP room creation)
  earnedIncomeShingo: number; // $/yr
  earnedIncomeSarah: number; // $/yr

  // New RRSP room each year = min(18% of earned income, rrspDollarLimit) - pension adjustment.
  // The dollar limit is indexed forward from rrspDollarLimitYear at expectedInflation.
  rrspDollarLimit: number; // $ for rrspDollarLimitYear (2026: $33,810)
  rrspDollarLimitYear: number;

  // Annual pension adjustment (PA) reported on each T4. For members of a
  // defined-benefit plan this consumes most of the 18%, so leaving it at 0
  // materially overstates available RRSP room.
  pensionAdjustmentShingo: number; // $/yr
  pensionAdjustmentSarah: number; // $/yr

  // Annual tax drag on NON-REGISTERED growth: the share of the return lost each
  // year to tax on interest, dividends and realized gains. Applied as a haircut
  // to the nominal return on the non-registered account only.
  // ~0.75% is typical for a balanced portfolio held long-term; raise it for
  // interest-heavy holdings or frequent trading, set 0 to disable.
  nonRegTaxDragRate: number; // e.g. 0.0075

  // Target year you stop working / begin retirement plan
  retirementYear: number;

  // Derived from retirementYear by default, but can be overridden if you want.
  shingoRetireAge: number;
  sarahRetireAge: number;
  cppStartAge: number;
  oasStartAge: number;

  // Expectations
  expectedNominalReturn: number; // e.g. 0.07
  expectedInflation: number; // e.g. 0.02
  /**
   * Post-retirement indexation of DB pensions — how the cheque grows once it is
   * being paid. NOT the salary-escalation assumption a pension calculator uses
   * to project the starting amount; those are different numbers and conflating
   * them silently inflates income for the whole plan.
   *
   * Kept as the fallback for either spouse when no per-person rate is set.
   */
  pensionIndexRate: number;

  /** Per-person overrides. Many Canadian DB plans index conditionally or not at all. */
  pensionIndexRateShingo?: number;
  pensionIndexRateSarah?: number;

  // Contributions
  monthly: MonthlyContributions;
  fhsa: FhsaInputs;

  // Retirement phases
  phaseAges: PhaseAges;
  spending: PhaseSpending;

  // Withdrawals (retirement)
  withdrawals: WithdrawalPlan;

  // Taxes (simple estimator inputs)
  tax: TaxInputs;

  // Baseline balances (as-of baselineYear snapshot)
  balances: AccountBalances;

  // ISO date string (YYYY-MM-DD) recording when balances were last updated.
  balancesAsOf: string;

  // True if the TFSA balances above already include the most recent tax refund deposit.
  // When true, the accumulation model will not project additional refund→TFSA amounts.
  tfsaIncludesRefund: boolean;
};

// From your notes: Jan 2026 snapshot
export const DEFAULT_ANCHORS: Anchors = {
  location: "British Columbia, Canada",
  targetRetirementYear: 2036,
  baselineYear: 2026,

  shingoBirthYear: 1969,
  sarahBirthYear: 1971,

  /**
   * PENCAN (Christian Education Pension Plan), 60% Joint & Survivor.
   *
   * Formula, per the 2025 Annual Status Letter, for service after 01/09/2010:
   *   adjusted credited service x best-5-year average earnings x 1.90%
   *   = 16.8967 x $103,957.60 x 1.90% = $33,374.27 as "Life Only"
   *
   * 60% J&S is the plan's DEFAULT for a participant with an eligible spouse,
   * and pays $30,967.99 to Shingo plus $18,580.79 to Sarah for life if he dies
   * first. The Life Only figure of $33,374.27 previously used here pays her
   * nothing, and is not what the plan would apply by default.
   *
   * Basis: PENCAN's own 2% annual salary increase assumption, retirement
   * 02/01/2036 at age 67. Actual salary growth has run ~6%/yr (2023-2025),
   * which would raise this to roughly $37,500 -- deliberately NOT used, since
   * the plan freezes pensionable earnings at 31/08/2030 and the recent trend
   * may not hold. This is the conservative figure.
   *
   * NOT indexed after retirement — see pensionIndexRateShingo.
   */
  pensionShingo: 30967.99,
  /**
   * UNVERIFIED. Unlike Shingo's, this figure has no supporting document on file
   * — no plan name, formula, survivor election or indexation basis. Whether it
   * is a Life Only or joint-and-survivor amount is unknown, and
   * pensionIndexRateSarah is a guess. Worth the same scrutiny his has had.
   */
  pensionSarah: 38400,

  cppShingoAt70Monthly: 1700,
};

export const DEFAULT_VARIABLES: Variables = {
  dollarsMode: "nominal",
  cpiMultiplier: 1,

  // As-of baseline snapshot (Jan 2026)
  tfsaRoomShingo: 105352.19,
  tfsaRoomSarah: 109000,
  rrspRoomShingo: 120125,
  rrspRoomSarah: 63252,

  // 2025 pensionable earnings, implied by his 2025 PA at the 1.90% effective
  // accrual rate derived from his 2023 Notice of Assessment. Paired with the
  // 2025 PA below so the two are from the same year -- mixing years is what
  // made the old $100,000 / $16,275 pairing overstate new room.
  // Note: earnings have grown ~6.0%/yr (2023 $87,800 -> 2025 $98,591). This
  // model holds them flat. That is defensible only because the PA is held flat
  // too, and the two largely cancel; do not inflate one without the other.
  earnedIncomeShingo: 98591,
  earnedIncomeSarah: 100000,

  // CRA RRSP dollar limit for 2026.
  rrspDollarLimit: 33810,
  rrspDollarLimitYear: 2026,

  // Shingo: box 52 of his 2025 T4. Paired with earnedIncomeShingo above, both
  // 2025 figures, this gives $1,471/yr of new room -- against $17,746/yr if the
  // PA were left at zero. His $120,125 of carried-forward room absorbs most of
  // the difference. Series on file: 2023 $14,428, 2024 $15,333, 2025 $16,275.
  pensionAdjustmentShingo: 16275,

  // PLACEHOLDER: Sarah's own T4 box 52, still needed. This one matters more
  // than Shingo's: she starts with about half his carried-forward room
  // ($63,252), so a PA near his exhausts it in 2033 and costs roughly $53,000
  // of contributions by retirement. At a PA of $10,000 there is no impact at
  // all. Do not assume it matches his.
  pensionAdjustmentSarah: 0,

  nonRegTaxDragRate: 0.0075,

  retirementYear: DEFAULT_ANCHORS.targetRetirementYear,
  shingoRetireAge: 67,
  sarahRetireAge: 65,
  cppStartAge: 70,
  oasStartAge: 70,

  expectedNominalReturn: 0.07,
  expectedInflation: 0.03,
  pensionIndexRate: 0.02, // fallback only

  // Shingo's PENCAN pension is NOT indexed — the cheque is fixed for life and
  // its purchasing power erodes with inflation. (The 2% previously used here
  // came from PENCAN's "2% Annual Salary Increase", which projects the starting
  // amount; it says nothing about indexation after retirement.)
  pensionIndexRateShingo: 0,

  // UNVERIFIED: Sarah's plan indexation has not been confirmed. Left at 2% so
  // this change does not silently move her numbers. Canadian DB indexation is
  // often conditional on plan funding rather than guaranteed — check her plan
  // booklet or annual statement and set the real figure.
  pensionIndexRateSarah: 0.02,

  // From your screenshot: monthly investments
  monthly: {
    tfsaTotal: 0,
    fhsaSarah: 666,
    rrspSarah: 700,
    fhsaShingo: 666,
    rrspShingo: 700,
  },

  // FHSA contribution facts + rules
  fhsa: {
    annualLimit: 8000,
    lifetimeCap: 40000,
    contributedShingo: 16666,
    contributedSarah: 8666,
  },

  phaseAges: {
    goGoEndAge: 74,
    slowGoEndAge: 84,
    endAge: 90,
  },

  spending: {
    goGo: 100000,
    slowGo: 90000,
    noGo: 75000,
  },

  withdrawals: {
    // Default: don’t draw FHSA first (it can be rolled into RRSP)
    order: ["rrsp", "lira", "nonRegistered", "tfsa", "fhsa"],
    avoidOasClawback: true,
    rrifFrontLoad: 0,
    rrifMinMultiplier: 1,
    rollFhsaIntoRrspAtRetirement: true,

    // Default: projected household TFSA room at retirement.
    // Based on Jan 1 2026 remaining room ($185,547.06) + 10 years of new room at ~$7,000/yr
    // minus planned TFSA contributions ($80/mo).
    tfsaRoomAtRetirement: 245947.06,
    tfsaNewRoomPerYear: 14000,
    caps: {
      fhsa: 0,
      rrsp: 0,
      lira: 0,
      tfsa: 0,
      nonRegistered: 0,
    },
    // Default requested: BC maximum (v1 approximation)
    lifMode: "max",
    forceLifFromRetirement: true,

    // RRIF depletion target (age) — planning lever
    // (v1: used for display only; enforcement comes next)
    rrifDepleteByAge: 75,

    allowTfsa: false,

    // placeholders (we’ll compute these from rules later; for now editable)
    // Defaults are placeholders; adjust to your Service Canada estimates.
    cppShingoAnnual: DEFAULT_ANCHORS.cppShingoAt70Monthly * 12,
    // KNOWN PLACEHOLDER: Sarah's real CPP estimate is not yet on file — this
    // just copies Shingo's figure as a stand-in. Replace with her own
    // Service Canada "estimate of monthly CPP retirement pension" once available.
    cppSarahAnnual: DEFAULT_ANCHORS.cppShingoAt70Monthly * 12,
    // Rough OAS-at-70 placeholder (annual). Replace with your preferred assumption.
    oasShingoAnnual: 11000,
    oasSarahAnnual: 11000,

    rrspExtraByYear: {},
  },

  tax: {
    taxYear: 2036,

    useBpa: true,
    useAgeAmount: true,
    usePensionCredit: true,
    enablePensionSplitting: true,

    shingoEmployment: 0,
    sarahEmployment: 0,

    shingoPensionDb: 31345,
    sarahPensionDb: 38400,

    shingoRrif: 0,
    sarahRrif: 0,

    shingoLif: 0,
    sarahLif: 0,

    shingoRrsp: 0,
    sarahRrsp: 0,

    shingoCpp: 0,
    sarahCpp: 0,

    shingoOas: 0,
    sarahOas: 0,

    shingoTfsa: 0,
    sarahTfsa: 0,

    // Working-year refund modeling inputs
    workingIncomeShingo: 100000,
    workingIncomeSarah: 100000,
  },

  balancesAsOf: new Date().toISOString().slice(0, 10),
  tfsaIncludesRefund: true,

  balances: {
    fhsaShingo: 18521.09,
    fhsaSarah: 8596.0,
    rrspShingo: 18045.98,
    rrspSarah: 3950.93,
    tfsaShingo: 2364.78,
    tfsaSarah: 2088.16,
    liraShingo: 174488.27,
    nonRegistered: 0.34,
  },
};
