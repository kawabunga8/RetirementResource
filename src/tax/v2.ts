import { pickTaxTables, type Bracket } from "./tables";

export type IncomeSources = {
  employment: number;
  pensionDb: number;
  rrspWithdrawal: number;
  rrifWithdrawal: number;
  lifWithdrawal: number;
  cpp: number;
  oas: number;
  tfsaWithdrawal: number;
  // Placeholders for later (not used in v2 yet)
  nonRegEligibleDividends?: number;
  nonRegCapGains?: number;
};

export type CreditsToggles = {
  useBpa: boolean;
  useAgeAmount: boolean;
  usePensionCredit: boolean;
};

export type HouseholdTaxInputs = {
  taxYear: number;
  spouseA: { name: string; age: number; incomes: IncomeSources };
  spouseB: { name: string; age: number; incomes: IncomeSources };
  credits: CreditsToggles;
  pensionSplitting: {
    enabled: boolean;
    // If true, choose split amount that minimizes combined (tax + clawback)
    optimize: boolean;
    step: number; // e.g. 100
  };
};

export type CreditsDetail = {
  fed: { bpa: number; age: number; pension: number; total: number };
  bc: { bpa: number; age: number; pension: number; total: number };
  total: number;
};

export type SpouseTaxResult = {
  name: string;
  age: number;
  taxableIncome: number;
  eligiblePensionIncome: number;
  federalTaxBeforeCredits: number;
  bcTaxBeforeCredits: number;
  credits: CreditsDetail;
  oasClawback: number;
  totalTax: number;
  afterTaxIncome: number;
};

export type HouseholdTaxResult = {
  spouseA: SpouseTaxResult;
  spouseB: SpouseTaxResult;
  household: {
    taxableIncome: number;
    totalTax: number;
    afterTaxIncome: number;
    oasClawback: number;
  };
  debug: {
    taxYear: number;
    tablesYear: number;
    splitting: {
      enabled: boolean;
      chosenSplitAmount: number; // amount shifted from higher-income to lower-income (eligible pension)
      from: string | null;
      to: string | null;
      evaluatedCandidates: number;
    };
    spouseA: {
      preSplitEligiblePensionIncome: number;
      postSplitEligiblePensionIncome: number;
      incomesUsed: IncomeSources;
    };
    spouseB: {
      preSplitEligiblePensionIncome: number;
      postSplitEligiblePensionIncome: number;
      incomesUsed: IncomeSources;
    };
  };
};

function clampToZero(n: number) {
  return n < 0 ? 0 : n;
}

function progressiveTax(income: number, brackets: Bracket[]) {
  const x = Math.max(0, income);
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    const cap = b.upTo;
    const amt = Math.max(0, Math.min(x, cap) - prev);
    tax += amt * b.rate;
    prev = cap;
    if (x <= cap) break;
  }
  return tax;
}

export type EligiblePensionIncomeParams = {
  age: number;
  incomes: IncomeSources;
};

/**
 * Eligible pension income for the pension amount credit and splitting.
 *
 * Planning logic (conservative):
 * - Employer DB pension counts at any age.
 * - At 65+, RRIF and LIF withdrawals count.
 * - RRSP withdrawals are treated as NOT eligible (unless converted to RRIF).
 * - CPP/OAS not eligible.
 */
export function eligiblePensionIncome(p: EligiblePensionIncomeParams) {
  const db = Math.max(0, p.incomes.pensionDb);
  const ageEligible = p.age >= 65;
  const rrif = ageEligible ? Math.max(0, p.incomes.rrifWithdrawal) : 0;
  const lif = ageEligible ? Math.max(0, p.incomes.lifWithdrawal) : 0;
  return db + rrif + lif;
}

function taxableIncomeFromSources(incomes: IncomeSources) {
  // TFSA withdrawals are non-taxable.
  // Non-registered dividends/cap gains ignored in v2 but leave hooks.
  return (
    Math.max(0, incomes.employment) +
    Math.max(0, incomes.pensionDb) +
    Math.max(0, incomes.rrspWithdrawal) +
    Math.max(0, incomes.rrifWithdrawal) +
    Math.max(0, incomes.lifWithdrawal) +
    Math.max(0, incomes.cpp) +
    Math.max(0, incomes.oas)
  );
}

function computeCredits(params: {
  taxYear: number;
  age: number;
  taxableIncome: number;
  eligiblePensionIncome: number;
  toggles: CreditsToggles;
}) {
  const tables = pickTaxTables(params.taxYear);

  const fed = {
    bpa: 0,
    age: 0,
    pension: 0,
    total: 0,
  };

  const bc = {
    bpa: 0,
    age: 0,
    pension: 0,
    total: 0,
  };

  if (params.toggles.useBpa) {
    fed.bpa = tables.federal.bpa * tables.federal.lowestRate;
    bc.bpa = tables.bc.bpa * tables.bc.lowestRate;
  }

  if (params.toggles.useAgeAmount && params.age >= 65) {
    // Income-tested phase-out (rough) against taxable income.
    const fedAmt = clampToZero(
      tables.federal.ageAmountMax -
        Math.max(0, params.taxableIncome - tables.federal.ageAmountThreshold) *
          tables.federal.ageAmountPhaseOutRate
    );

    const bcAmt = clampToZero(
      tables.bc.ageAmountMax -
        Math.max(0, params.taxableIncome - tables.bc.ageAmountThreshold) *
          tables.bc.ageAmountPhaseOutRate
    );

    fed.age = fedAmt * tables.federal.lowestRate;
    bc.age = bcAmt * tables.bc.lowestRate;
  }

  if (params.toggles.usePensionCredit && params.eligiblePensionIncome > 0) {
    const base = Math.min(
      tables.federal.pensionCreditBase,
      Math.max(0, params.eligiblePensionIncome)
    );
    fed.pension = base * tables.federal.lowestRate;
    bc.pension = base * tables.bc.lowestRate;
  }

  fed.total = fed.bpa + fed.age + fed.pension;
  bc.total = bc.bpa + bc.age + bc.pension;

  return {
    fed,
    bc,
    total: fed.total + bc.total,
  };
}

function computeOasClawback(params: {
  taxYear: number;
  netIncomeForClawback: number;
  oasReceived: number;
}) {
  const tables = pickTaxTables(params.taxYear);
  const excess = Math.max(0, params.netIncomeForClawback - tables.federal.oasClawbackThreshold);
  const claw = tables.federal.oasClawbackRate * excess;
  return Math.min(Math.max(0, params.oasReceived), Math.max(0, claw));
}

function computePerson(params: {
  taxYear: number;
  name: string;
  age: number;
  incomes: IncomeSources;
  credits: CreditsToggles;
}) {
  const tables = pickTaxTables(params.taxYear);

  const taxableIncome = taxableIncomeFromSources(params.incomes);
  const eligible = eligiblePensionIncome({ age: params.age, incomes: params.incomes });

  const fedBefore = progressiveTax(taxableIncome, tables.federal.brackets);
  const bcBefore = progressiveTax(taxableIncome, tables.bc.brackets);

  const credits = computeCredits({
    taxYear: params.taxYear,
    age: params.age,
    taxableIncome,
    eligiblePensionIncome: eligible,
    toggles: params.credits,
  });

  const taxAfterCredits = Math.max(0, fedBefore + bcBefore - credits.total);

  // OAS clawback is based on net income. We approximate with taxable income.
  const clawback = computeOasClawback({
    taxYear: params.taxYear,
    netIncomeForClawback: taxableIncome,
    oasReceived: Math.max(0, params.incomes.oas),
  });

  const totalTax = taxAfterCredits + clawback;
  const afterTax = taxableIncome - totalTax;

  return {
    name: params.name,
    age: params.age,
    taxableIncome,
    eligiblePensionIncome: eligible,
    federalTaxBeforeCredits: fedBefore,
    bcTaxBeforeCredits: bcBefore,
    credits,
    oasClawback: clawback,
    totalTax,
    afterTaxIncome: afterTax,
  } satisfies SpouseTaxResult;
}

function withSplit(incomes: IncomeSources, deltaEligiblePension: number) {
  // Apply split by adjusting the eligible pension buckets.
  // Prefer DB pension first, then RRIF, then LIF.
  const out: IncomeSources = { ...incomes };

  let remaining = deltaEligiblePension;
  // positive = add to recipient; negative = remove from donor.
  const sign = remaining >= 0 ? 1 : -1;
  remaining = Math.abs(remaining);

  const apply = (k: keyof IncomeSources) => {
    const current = Math.max(0, out[k] as number);
    if (sign < 0) {
      const take = Math.min(current, remaining);
      (out[k] as number) = current - take;
      remaining -= take;
    } else {
      (out[k] as number) = current + remaining;
      remaining = 0;
    }
  };

  // remove from DB -> RRIF -> LIF; add to DB as a generic "pensionDb" bucket
  // (planning simplification)
  if (sign < 0) {
    apply("pensionDb");
    if (remaining > 0) apply("rrifWithdrawal");
    if (remaining > 0) apply("lifWithdrawal");
  } else {
    // Add to pensionDb to keep it eligible by definition.
    apply("pensionDb");
  }

  return out;
}

/**
 * Compute household tax with an optional pension-income splitting optimizer.
 */
export function computeHouseholdTax(inputs: HouseholdTaxInputs): HouseholdTaxResult {
  const tables = pickTaxTables(inputs.taxYear);

  const preAEligible = eligiblePensionIncome({ age: inputs.spouseA.age, incomes: inputs.spouseA.incomes });
  const preBEligible = eligiblePensionIncome({ age: inputs.spouseB.age, incomes: inputs.spouseB.incomes });

  const baseA = taxableIncomeFromSources(inputs.spouseA.incomes);
  const baseB = taxableIncomeFromSources(inputs.spouseB.incomes);

  const debug = {
    taxYear: inputs.taxYear,
    tablesYear: tables.year,
    splitting: {
      enabled: inputs.pensionSplitting.enabled,
      chosenSplitAmount: 0,
      from: null as string | null,
      to: null as string | null,
      evaluatedCandidates: 0,
    },
    spouseA: {
      preSplitEligiblePensionIncome: preAEligible,
      postSplitEligiblePensionIncome: preAEligible,
      incomesUsed: inputs.spouseA.incomes,
    },
    spouseB: {
      preSplitEligiblePensionIncome: preBEligible,
      postSplitEligiblePensionIncome: preBEligible,
      incomesUsed: inputs.spouseB.incomes,
    },
  };

  // Determine split direction (from higher taxable income to lower), up to 50% of donor eligible pension.
  const aHigher = baseA >= baseB;
  const donor = aHigher ? inputs.spouseA : inputs.spouseB;
  const recipient = aHigher ? inputs.spouseB : inputs.spouseA;
  const donorEligible = aHigher ? preAEligible : preBEligible;

  const maxSplit = inputs.pensionSplitting.enabled ? 0.5 * donorEligible : 0;
  const step = Math.max(1, inputs.pensionSplitting.step || 100);

  const score = (splitAmt: number) => {
    // Split moves eligible pension from donor -> recipient
    const donorIncomes = withSplit(donor.incomes, -splitAmt);
    const recipientIncomes = withSplit(recipient.incomes, +splitAmt);

    const aIncomes = aHigher ? donorIncomes : recipientIncomes;
    const bIncomes = aHigher ? recipientIncomes : donorIncomes;

    const resA = computePerson({
      taxYear: inputs.taxYear,
      name: inputs.spouseA.name,
      age: inputs.spouseA.age,
      incomes: aIncomes,
      credits: inputs.credits,
    });

    const resB = computePerson({
      taxYear: inputs.taxYear,
      name: inputs.spouseB.name,
      age: inputs.spouseB.age,
      incomes: bIncomes,
      credits: inputs.credits,
    });

    return {
      splitAmt,
      total: resA.totalTax + resB.totalTax,
      resA,
      resB,
      aIncomes,
      bIncomes,
    };
  };

  let best = score(0);
  debug.splitting.evaluatedCandidates++;

  if (inputs.pensionSplitting.enabled && inputs.pensionSplitting.optimize && maxSplit > 0) {
    for (let s = 0; s <= maxSplit + 0.0001; s += step) {
      const cand = score(s);
      debug.splitting.evaluatedCandidates++;
      if (cand.total < best.total) best = cand;
    }
  }

  if (inputs.pensionSplitting.enabled && best.splitAmt > 0) {
    debug.splitting.chosenSplitAmount = best.splitAmt;
    debug.splitting.from = donor.name;
    debug.splitting.to = recipient.name;
  }

  debug.spouseA.incomesUsed = best.aIncomes;
  debug.spouseB.incomesUsed = best.bIncomes;
  debug.spouseA.postSplitEligiblePensionIncome = eligiblePensionIncome({ age: inputs.spouseA.age, incomes: best.aIncomes });
  debug.spouseB.postSplitEligiblePensionIncome = eligiblePensionIncome({ age: inputs.spouseB.age, incomes: best.bIncomes });

  const householdTaxable = best.resA.taxableIncome + best.resB.taxableIncome;
  const householdTax = best.resA.totalTax + best.resB.totalTax;
  const householdAfterTax = best.resA.afterTaxIncome + best.resB.afterTaxIncome;

  return {
    spouseA: best.resA,
    spouseB: best.resB,
    household: {
      taxableIncome: householdTaxable,
      totalTax: householdTax,
      afterTaxIncome: householdAfterTax,
      oasClawback: best.resA.oasClawback + best.resB.oasClawback,
    },
    debug,
  };
}
