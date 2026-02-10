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

export type WithdrawalPlan = {
  // In v1 we fill the annual income gap using this priority order.
  order: WithdrawalOrder[];

  // Annual caps (0 = no cap)
  caps: {
    fhsa: number;
    rrsp: number;
    lira: number;
    tfsa: number;
    nonRegistered: number;
  };

  // Optional: treat TFSA as “preserve unless needed”
  allowTfsa: boolean;

  // Simple benefit placeholders (annual, can be 0)
  cppShingoAnnual: number;
  cppSarahAnnual: number;
  oasShingoAnnual: number;
  oasSarahAnnual: number;
};

export type Variables = {
  shingoRetireAge: number;
  sarahRetireAge: number;
  cppStartAge: number;
  oasStartAge: number;

  // Expectations
  expectedNominalReturn: number; // e.g. 0.07
  expectedInflation: number; // e.g. 0.02

  // Contributions
  monthly: MonthlyContributions;

  // Retirement phases
  phaseAges: PhaseAges;
  spending: PhaseSpending;

  // Withdrawals (retirement)
  withdrawals: WithdrawalPlan;

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

  phaseAges: {
    goGoEndAge: 74,
    slowGoEndAge: 84,
    endAge: 95,
  },

  spending: {
    goGo: 90000,
    slowGo: 80000,
    noGo: 70000,
  },

  withdrawals: {
    order: ["fhsa", "rrsp", "lira", "nonRegistered", "tfsa"],
    caps: {
      fhsa: 0,
      rrsp: 0,
      lira: 0,
      tfsa: 0,
      nonRegistered: 0,
    },
    allowTfsa: false,

    // placeholders (we’ll compute these from rules later; for now editable)
    cppShingoAnnual: DEFAULT_ANCHORS.cppShingoAt70Monthly * 12,
    cppSarahAnnual: 0,
    oasShingoAnnual: 0,
    oasSarahAnnual: 0,
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
