export type PhaseSpending = {
  goGo: number;
  slowGo: number;
  noGo: number;
};

export type Anchors = {
  location: string;
  targetRetirementYear: number;
  pensionShingo: number; // annual, real/indexed
  pensionSarah: number; // annual, real/indexed
  cppShingoAt70Monthly: number;
  cppAssumedSarahAt70Monthly?: number;
};

export type Variables = {
  shingoRetireAge: number;
  sarahRetireAge: number;
  cppStartAge: number;
  oasStartAge: number;
  nominalReturn: number; // e.g. 0.07
  monthlyRrspContribution: number;
  spending: PhaseSpending;
};

export const DEFAULT_ANCHORS: Anchors = {
  location: "British Columbia, Canada",
  targetRetirementYear: 2036,
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
  monthlyRrspContribution: 2700,
  spending: {
    goGo: 90000,
    slowGo: 80000,
    noGo: 70000,
  },
};
