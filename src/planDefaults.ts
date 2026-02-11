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
};

export type TaxInputs = {
  // Tax year for credits/age-related features
  taxYear: number;

  // Income inputs (taxable income approximation)
  shingoIncome: number;
  sarahIncome: number;

  // Credits toggles (auto defaults based on age)
  useBpa: boolean;
  useAgeAmount: boolean;
  usePensionCredit: boolean;

  // Eligible pension income used for the pension amount credit
  eligiblePensionIncomeShingo: number;
  eligiblePensionIncomeSarah: number;

  // Refund modeling (v1)
  // If enabled, we estimate annual tax savings from RRSP+FHSA contributions
  // and deposit the refund into TFSA once per year.
  enableRefundToTfsa: boolean;
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
};

// From your notes: Jan 2026 snapshot
export const DEFAULT_ANCHORS: Anchors = {
  location: "British Columbia, Canada",
  targetRetirementYear: 2036,
  baselineYear: 2026,

  shingoBirthYear: 1969,
  sarahBirthYear: 1971,

  pensionShingo: 29000,
  pensionSarah: 35000,

  cppShingoAt70Monthly: 1700,
};

export const DEFAULT_VARIABLES: Variables = {
  dollarsMode: "nominal",
  retirementYear: DEFAULT_ANCHORS.targetRetirementYear,
  shingoRetireAge: 67,
  sarahRetireAge: 65,
  cppStartAge: 70,
  oasStartAge: 70,

  expectedNominalReturn: 0.07,
  expectedInflation: 0.02,

  // From your screenshot: monthly investments
  monthly: {
    tfsaTotal: 80,
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
    goGo: 90000,
    slowGo: 80000,
    noGo: 70000,
  },

  withdrawals: {
    // Default: don’t draw FHSA first (it can be rolled into RRSP)
    order: ["rrsp", "lira", "nonRegistered", "tfsa", "fhsa"],
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
    cppSarahAnnual: DEFAULT_ANCHORS.cppShingoAt70Monthly * 12,
    // Rough OAS-at-70 placeholder (annual). Replace with your preferred assumption.
    oasShingoAnnual: 11000,
    oasSarahAnnual: 11000,
  },

  tax: {
    taxYear: 2036,
    shingoIncome: 100000,
    sarahIncome: 100000,

    useBpa: true,
    useAgeAmount: true,
    usePensionCredit: true,

    // Default: treat pensions as eligible for the pension amount credit (adjust if needed)
    eligiblePensionIncomeShingo: 29000,
    eligiblePensionIncomeSarah: 35000,

    enableRefundToTfsa: true,
  },

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
