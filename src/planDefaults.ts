export type PhaseSpending = {
  goGo: number;
  slowGo: number;
  noGo: number;
};

export type Anchors = {
  location: string;
  targetRetirementYear: number;
  baselineYear: number;

  // Guaranteed / quasi-guaranteed income (annual, real/indexed)
  pensionShingo: number;
  pensionSarah: number;

  // Benefit assumptions (today these are placeholders for later modeling)
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

export type Variables = {
  shingoRetireAge: number;
  sarahRetireAge: number;
  cppStartAge: number;
  oasStartAge: number;

  nominalReturn: number; // e.g. 0.07

  // Contributions (simple v1)
  monthlyTotalContribution: number; // total household contributions toward investments

  spending: PhaseSpending;

  // Baseline balances (as-of baselineYear snapshot)
  balances: AccountBalances;
};

// From your notes: Jan 2026 snapshot
export const DEFAULT_ANCHORS: Anchors = {
  location: "British Columbia, Canada",
  targetRetirementYear: 2036,
  baselineYear: 2026,
  pensionShingo: 29000,
  pensionSarah: 35000,
  cppShingoAt70Monthly: 1700,
};

export const DEFAULT_VARIABLES: Variables = {
  shingoRetireAge: 67,
  sarahRetireAge: 65,
  cppStartAge: 70,
  oasStartAge: 70,

  nominalReturn: 0.07,

  // Placeholder until we break contributions out by account (FHSA vs RRSP vs TFSA, etc.)
  monthlyTotalContribution: 2700,

  spending: {
    goGo: 90000,
    slowGo: 80000,
    noGo: 70000,
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
