import {
  getIndexedTaxTables,
  pickTaxTables,
  DEFAULT_TAX_INDEXATION,
  INVESTMENT_INCOME_RULES as INV,
  type Bracket,
  type TaxYearTables,
} from "./tables";

/**
 * OAS recovery-tax threshold for a given year, indexed forward from the newest
 * published table. Pass the plan's inflation assumption so the threshold keeps
 * pace with the (also indexed) OAS payment.
 */
export function getOasClawbackThreshold(taxYear: number, annualInflation = DEFAULT_TAX_INDEXATION) {
  return getIndexedTaxTables(taxYear, annualInflation).federal.oasClawbackThreshold;
}


export type IncomeSources = {
  employment: number;
  pensionDb: number;
  rrspWithdrawal: number;
  rrifWithdrawal: number;
  lifWithdrawal: number;
  cpp: number;
  oas: number;
  tfsaWithdrawal: number;
  /*
   * Non-registered investment income, as the CASH amounts received -- never
   * pre-grossed-up or pre-halved; the engine applies those rules.
   */
  /** Interest and foreign dividends: fully taxable, like salary. */
  interest?: number;
  /** Canadian eligible dividends: grossed up 38%, then the dividend tax credit. */
  eligibleDividends?: number;
  /** Canadian non-eligible dividends: grossed up 15%, then a smaller credit. */
  nonEligibleDividends?: number;
  /** REALIZED capital gains, full amount. Half is taxable. Never pass unrealized growth. */
  capitalGains?: number;
};

export type CreditsToggles = {
  useBpa: boolean;
  useAgeAmount: boolean;
  usePensionCredit: boolean;
};

export type HouseholdTaxInputs = {
  taxYear: number;
  /**
   * Annual indexation applied to brackets, the BPA, the age amount and the OAS
   * clawback threshold for years beyond the newest published table.
   * Defaults to DEFAULT_TAX_INDEXATION; pass the plan's inflation assumption.
   */
  annualInflation?: number;
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
  fed: { bpa: number; age: number; pension: number; dividend: number; total: number };
  bc: { bpa: number; age: number; pension: number; dividend: number; total: number };
  total: number;
};

export type SpouseTaxResult = {
  name: string;
  age: number;
  /**
   * Every taxable source after pension splitting -- "net income before
   * adjustments" (line 23400), since this model has no other deductions. The
   * OAS clawback threshold is measured against THIS figure.
   */
  totalIncome: number;
  /**
   * totalIncome less the OAS repayment, which is deductible (line 23500).
   * The brackets apply to this. Equal to totalIncome in any year without a
   * clawback.
   */
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
    totalIncome: number;
    taxableIncome: number;
    totalTax: number;
    afterTaxIncome: number;
    oasClawback: number;
  };
  debug: {
    taxYear: number;
    tablesYear: number;
    indexationRate: number;
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

const pos = (x: number | undefined) => Math.max(0, x ?? 0);

/** Grossed-up (taxable) amounts of each dividend type. */
function grossedUpDividends(incomes: IncomeSources) {
  return {
    eligible: pos(incomes.eligibleDividends) * (1 + INV.eligibleDividendGrossUp),
    nonEligible: pos(incomes.nonEligibleDividends) * (1 + INV.nonEligibleDividendGrossUp),
  };
}

/**
 * Line 23400 total: every source at its TAXABLE amount -- dividends grossed
 * up, capital gains at the inclusion rate. TFSA withdrawals are not income.
 */
function totalIncomeFromSources(incomes: IncomeSources) {
  const div = grossedUpDividends(incomes);
  return (
    Math.max(0, incomes.employment) +
    Math.max(0, incomes.pensionDb) +
    Math.max(0, incomes.rrspWithdrawal) +
    Math.max(0, incomes.rrifWithdrawal) +
    Math.max(0, incomes.lifWithdrawal) +
    Math.max(0, incomes.cpp) +
    Math.max(0, incomes.oas) +
    pos(incomes.interest) +
    div.eligible +
    div.nonEligible +
    pos(incomes.capitalGains) * INV.capitalGainsInclusion
  );
}

/** Money actually received: dividends at face value, gains in full. */
function cashIncomeFromSources(incomes: IncomeSources) {
  return (
    Math.max(0, incomes.employment) +
    Math.max(0, incomes.pensionDb) +
    Math.max(0, incomes.rrspWithdrawal) +
    Math.max(0, incomes.rrifWithdrawal) +
    Math.max(0, incomes.lifWithdrawal) +
    Math.max(0, incomes.cpp) +
    Math.max(0, incomes.oas) +
    pos(incomes.interest) +
    pos(incomes.eligibleDividends) +
    pos(incomes.nonEligibleDividends) +
    pos(incomes.capitalGains)
  );
}

function computeCredits(params: {
  tables: TaxYearTables;
  age: number;
  /** Net income (line 23600): the age amount is income-tested against this. */
  netIncome: number;
  eligiblePensionIncome: number;
  /** Grossed-up dividends, for the dividend tax credits. */
  dividends: { eligible: number; nonEligible: number };
  toggles: CreditsToggles;
}) {
  const tables = params.tables;

  const fed = {
    bpa: 0,
    age: 0,
    pension: 0,
    dividend: 0,
    total: 0,
  };

  const bc = {
    bpa: 0,
    age: 0,
    pension: 0,
    dividend: 0,
    total: 0,
  };

  if (params.toggles.useBpa) {
    fed.bpa = tables.federal.bpa * tables.federal.lowestRate;
    bc.bpa = tables.bc.bpa * tables.bc.lowestRate;
  }

  if (params.toggles.useAgeAmount && params.age >= 65) {
    // Income-tested phase-out against net income.
    const fedAmt = Math.max(0,
      tables.federal.ageAmountMax -
        Math.max(0, params.netIncome - tables.federal.ageAmountThreshold) *
          tables.federal.ageAmountPhaseOutRate
    );

    const bcAmt = Math.max(0,
      tables.bc.ageAmountMax -
        Math.max(0, params.netIncome - tables.bc.ageAmountThreshold) *
          tables.bc.ageAmountPhaseOutRate
    );

    fed.age = fedAmt * tables.federal.lowestRate;
    bc.age = bcAmt * tables.bc.lowestRate;
  }

  if (params.toggles.usePensionCredit && params.eligiblePensionIncome > 0) {
    const eligibleAmt = Math.max(0, params.eligiblePensionIncome);
    fed.pension = Math.min(tables.federal.pensionCreditBase, eligibleAmt) * tables.federal.lowestRate;
    bc.pension = Math.min(tables.bc.pensionCreditBase, eligibleAmt) * tables.bc.lowestRate;
  }

  // Dividend tax credits: a percentage of the grossed-up dividend, federal and
  // BC separately. Non-refundable, like the rest -- they can bring tax to zero
  // but never below (the Math.max in computePerson).
  fed.dividend =
    params.dividends.eligible * INV.federalDividendCredit.eligible +
    params.dividends.nonEligible * INV.federalDividendCredit.nonEligible;
  bc.dividend =
    params.dividends.eligible * INV.bcDividendCredit.eligible +
    params.dividends.nonEligible * INV.bcDividendCredit.nonEligible;

  fed.total = fed.bpa + fed.age + fed.pension + fed.dividend;
  bc.total = bc.bpa + bc.age + bc.pension + bc.dividend;

  return {
    fed,
    bc,
    total: fed.total + bc.total,
  };
}

function computeOasClawback(params: {
  tables: TaxYearTables;
  netIncomeForClawback: number;
  oasReceived: number;
}) {
  const tables = params.tables;
  const excess = Math.max(0, params.netIncomeForClawback - tables.federal.oasClawbackThreshold);
  const claw = tables.federal.oasClawbackRate * excess;
  return Math.min(Math.max(0, params.oasReceived), Math.max(0, claw));
}

function computePerson(params: {
  tables: TaxYearTables;
  name: string;
  age: number;
  incomes: IncomeSources;
  credits: CreditsToggles;
}) {
  const tables = params.tables;

  // Line 23400, net income before adjustments. Every source enters at its
  // taxable amount (dividends grossed up, gains halved) and none of the
  // deductions between total income and net income (RRSP contributions,
  // carrying charges...) apply in retirement, so the sum IS this line -- not an
  // approximation of it. Grossed-up dividends count toward the OAS threshold,
  // as they do on a real return.
  const totalIncome = totalIncomeFromSources(params.incomes);
  const eligible = eligiblePensionIncome({ age: params.age, incomes: params.incomes });

  // The OAS recovery tax is measured against line 23400...
  const clawback = computeOasClawback({
    tables,
    netIncomeForClawback: totalIncome,
    oasReceived: Math.max(0, params.incomes.oas),
  });

  // ...and the repayment is then DEDUCTED (line 23500) in arriving at net
  // income, so the OAS that is clawed back is not also taxed at the marginal
  // rate. This used to be skipped, overstating tax in any clawback year.
  const netIncome = totalIncome - clawback;
  const taxableIncome = netIncome; // no line 25700 deductions in this model

  const fedBefore = progressiveTax(taxableIncome, tables.federal.brackets);
  const bcBefore = progressiveTax(taxableIncome, tables.bc.brackets);

  const credits = computeCredits({
    tables,
    age: params.age,
    netIncome,
    eligiblePensionIncome: eligible,
    dividends: grossedUpDividends(params.incomes),
    toggles: params.credits,
  });

  const taxAfterCredits =
    Math.max(0, fedBefore - credits.fed.total) +
    Math.max(0, bcBefore - credits.bc.total);

  const totalTax = taxAfterCredits + clawback;
  // Cash in hand: everything actually received (dividends at face value, not
  // grossed up), less everything owed.
  const afterTax = cashIncomeFromSources(params.incomes) - totalTax;

  return {
    name: params.name,
    age: params.age,
    totalIncome,
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
  const annualInflation = inputs.annualInflation ?? DEFAULT_TAX_INDEXATION;
  const tables = getIndexedTaxTables(inputs.taxYear, annualInflation);

  const preAEligible = eligiblePensionIncome({ age: inputs.spouseA.age, incomes: inputs.spouseA.incomes });
  const preBEligible = eligiblePensionIncome({ age: inputs.spouseB.age, incomes: inputs.spouseB.incomes });

  const baseA = totalIncomeFromSources(inputs.spouseA.incomes);
  const baseB = totalIncomeFromSources(inputs.spouseB.incomes);

  const debug = {
    taxYear: inputs.taxYear,
    // Which PUBLISHED table the indexed figures were extrapolated from.
    tablesYear: pickTaxTables(inputs.taxYear).year,
    indexationRate: annualInflation,
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
      tables,
      name: inputs.spouseA.name,
      age: inputs.spouseA.age,
      incomes: aIncomes,
      credits: inputs.credits,
    });

    const resB = computePerson({
      tables,
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

  const householdTotal = best.resA.totalIncome + best.resB.totalIncome;
  const householdTaxable = best.resA.taxableIncome + best.resB.taxableIncome;
  const householdTax = best.resA.totalTax + best.resB.totalTax;
  const householdAfterTax = best.resA.afterTaxIncome + best.resB.afterTaxIncome;

  return {
    spouseA: best.resA,
    spouseB: best.resB,
    household: {
      totalIncome: householdTotal,
      taxableIncome: householdTaxable,
      totalTax: householdTax,
      afterTaxIncome: householdAfterTax,
      oasClawback: best.resA.oasClawback + best.resB.oasClawback,
    },
    debug,
  };
}
