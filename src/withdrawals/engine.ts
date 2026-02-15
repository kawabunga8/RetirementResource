import { computeHouseholdTax, getOasClawbackThreshold } from "../tax/v2";
import type { LifMode, Variables, WithdrawalOrder } from "../planDefaults";
import { DEFAULT_ANCHORS } from "../planDefaults";

export type RetirementBalances = {
  fhsa: number;
  rrsp: number;
  tfsa: number;
  lira: number;
  nonRegistered: number;
};

export type WithdrawalSources = {
  fhsa: number;
  rrsp: number;
  lira: number;
  nonRegistered: number;
  tfsa: number;
};

export type WithdrawalDebug = {
  // Spending targets
  targetAfterTaxNominal: number;
  targetAfterTaxReal: number;

  // Tax outputs
  taxableIncomeShingo: number;
  taxableIncomeSarah: number;
  tax: number;
  oasClawbackShingo: number;
  oasClawbackSarah: number;

  // Guardrails
  oasClawbackThreshold: number;
  taxableIncomeCeiling: number;
  ceilingBinding: boolean;

  // Mandatory / glidepath
  lifMinRequired: number;
  lifMaxAllowed: number;
  lifMode: LifMode;
  rrifMinRequired: number;
  rrifGlideTarget: number;

  // Solver
  iterations: number;
  afterTaxCashAvailable: number;
  surplusAfterTax: number;
  shortfallAfterTax: number;
};

export type WithdrawalScheduleRow = {
  year: number;
  ageShingo: number;
  ageSarah: number;
  phase: "Go-Go" | "Slow-Go" | "No-Go";

  targetAfterTaxSpending: number; // nominal
  guaranteedIncome: number; // nominal
  benefitsIncome: number; // nominal

  withdrawals: WithdrawalSources;

  surplusInvestedToTfsa: number;
  surplusInvestedToNonReg: number;

  endBalances: RetirementBalances;

  debug: WithdrawalDebug;
};

function clampToZero(n: number) {
  return n < 0 ? 0 : n;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function withdrawFrom(amount: number, balance: number, cap: number) {
  if (amount <= 0) return { withdrawn: 0, remainingNeed: 0, newBalance: balance };

  const allowed = cap > 0 ? Math.min(amount, cap) : amount;
  const withdrawn = Math.min(allowed, Math.max(0, balance));
  return {
    withdrawn,
    remainingNeed: amount - withdrawn,
    newBalance: balance - withdrawn,
  };
}

export function rrifMinFactor(age: number) {
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
  return table[age] ?? 0;
}

function lifMinMaxFactors(age: number) {
  // Planning approximation (BC): min modeled as RRIF min, max ≈ 2x min (capped at 20%).
  const minF = rrifMinFactor(age);
  const maxF = Math.min(0.2, minF * 2);
  return { minF, maxF };
}

function lifMaxFactor(age: number, mode: LifMode) {
  const { minF, maxF } = lifMinMaxFactors(age);
  if (mode === "min") return minF;
  if (mode === "max") return maxF;
  return (minF + maxF) / 2;
}

function nominalFromRealBase(params: {
  amountReal: number;
  annualIndexRate: number;
  yearsFromBaseline: number;
}) {
  return params.amountReal * Math.pow(1 + params.annualIndexRate, Math.max(0, params.yearsFromBaseline));
}

function rrifGlideAmount(params: {
  balance: number;
  age: number;
  depleteByAge: number;
  frontLoad: number;
}) {
  if (params.balance <= 0) return 0;
  if (params.age > params.depleteByAge) return 0;

  const yearsLeft = Math.max(1, params.depleteByAge - params.age + 1);

  const f = clamp01(params.frontLoad);
  const ratio = 1 + 4 * f; // 1..5 (higher = more front-loaded)

  const sumWeights = ratio === 1 ? yearsLeft : (Math.pow(ratio, yearsLeft) - 1) / (ratio - 1);
  const w0 = Math.pow(ratio, yearsLeft - 1);
  const requiredThisYear = params.balance * (w0 / sumWeights);
  return requiredThisYear;
}

function sumWithdrawals(w: WithdrawalSources) {
  return w.fhsa + w.rrsp + w.lira + w.nonRegistered + w.tfsa;
}

function applyWithdrawalOrder(params: {
  need: number;
  order: WithdrawalOrder[];
  allowTfsa: boolean;
  balances: RetirementBalances;
  withdrawals: WithdrawalSources;
  caps: Variables["withdrawals"]["caps"];
  ageShingo: number;
  lifMode: LifMode;
  taxableHeadroom: {
    // Max *additional* taxable dollars for each person before hitting ceiling.
    shingo: number;
    sarah: number;
    household: number;
  };
  avoidTaxable: boolean;
}) {
  let need = params.need;

  for (const src of params.order) {
    if (need <= 0) break;

    if (src === "pension") continue;
    if (src === "tfsa" && !params.allowTfsa) continue;

    if (params.avoidTaxable && (src === "rrsp" || src === "lira" || src === "fhsa")) {
      continue;
    }

    if (src === "fhsa") {
      // treat FHSA as taxable (RRSP-like) in drawdown planning.
      const capByCeiling = params.taxableHeadroom.household;
      const cap = params.caps.fhsa > 0 ? Math.min(params.caps.fhsa, capByCeiling) : capByCeiling;
      const r = withdrawFrom(Math.min(need, capByCeiling), params.balances.fhsa, cap);
      params.withdrawals.fhsa += r.withdrawn;
      params.balances.fhsa = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "rrsp") {
      // household RRSP assumed split 50/50 for taxable-income purposes.
      const capByCeiling = params.taxableHeadroom.household;
      const cap = params.caps.rrsp > 0 ? Math.min(params.caps.rrsp, capByCeiling) : capByCeiling;
      const r = withdrawFrom(Math.min(need, capByCeiling), params.balances.rrsp, cap);
      params.withdrawals.rrsp += r.withdrawn;
      params.balances.rrsp = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "lira") {
      const lifMax = params.balances.lira * lifMaxFactor(params.ageShingo, params.lifMode);
      const explicitCap = params.caps.lira;
      const capCandidate = explicitCap > 0 ? Math.min(explicitCap, lifMax) : lifMax;
      const capByCeiling = params.taxableHeadroom.shingo;
      const cap = Math.min(capCandidate, capByCeiling);

      const r = withdrawFrom(need, params.balances.lira, cap);
      params.withdrawals.lira += r.withdrawn;
      params.balances.lira = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "nonRegistered") {
      // v2 does not model cap gains/dividends yet; treat as after-tax cash for now.
      const r = withdrawFrom(need, params.balances.nonRegistered, params.caps.nonRegistered);
      params.withdrawals.nonRegistered += r.withdrawn;
      params.balances.nonRegistered = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "tfsa") {
      const r = withdrawFrom(need, params.balances.tfsa, params.caps.tfsa);
      params.withdrawals.tfsa += r.withdrawn;
      params.balances.tfsa = r.newBalance;
      need = r.remainingNeed;
    }
  }

  return need;
}

export function buildWithdrawalSchedule(params: {
  vars: Variables;
  retirementYear: number;
  retirementBalances: RetirementBalances;
}) {
  const { vars } = params;

  const indexRate = vars.expectedInflation * vars.cpiMultiplier;
  const pensionAnnualReal = DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const retireAgeShingo = vars.shingoRetireAge;
  const retireAgeSarah = vars.sarahRetireAge;

  const yearsInPlan = Math.max(0, vars.phaseAges.endAge - Math.min(retireAgeShingo, retireAgeSarah) + 1);

  const rows: WithdrawalScheduleRow[] = [];

  let balances: RetirementBalances = { ...params.retirementBalances };
  let tfsaRoom = Math.max(0, vars.withdrawals.tfsaRoomAtRetirement);

  for (let i = 0; i < yearsInPlan; i++) {
    const year = params.retirementYear + i;

    // TFSA room creation during retirement (household)
    tfsaRoom += Math.max(0, vars.withdrawals.tfsaNewRoomPerYear);

    const ageShingo = retireAgeShingo + i;
    const ageSarah = retireAgeSarah + i;

    const phase: "Go-Go" | "Slow-Go" | "No-Go" =
      ageShingo <= vars.phaseAges.goGoEndAge
        ? "Go-Go"
        : ageShingo <= vars.phaseAges.slowGoEndAge
          ? "Slow-Go"
          : "No-Go";

    const targetAfterTaxReal =
      phase === "Go-Go" ? vars.spending.goGo : phase === "Slow-Go" ? vars.spending.slowGo : vars.spending.noGo;

    const yearsFromBaseline = year - DEFAULT_ANCHORS.baselineYear;
    // Spending targets are defined as REAL (today dollars). Convert using FULL inflation (not partial CPI).
    const targetAfterTaxNominal = nominalFromRealBase({
      amountReal: targetAfterTaxReal,
      annualIndexRate: vars.expectedInflation,
      yearsFromBaseline,
    });

    const guaranteedIncome = nominalFromRealBase({
      amountReal: pensionAnnualReal,
      annualIndexRate: indexRate,
      yearsFromBaseline,
    });

    const benefitsIncomeReal =
      (ageShingo >= vars.cppStartAge ? vars.withdrawals.cppShingoAnnual : 0) +
      (ageSarah >= vars.cppStartAge ? vars.withdrawals.cppSarahAnnual : 0) +
      (ageShingo >= vars.oasStartAge ? vars.withdrawals.oasShingoAnnual : 0) +
      (ageSarah >= vars.oasStartAge ? vars.withdrawals.oasSarahAnnual : 0);

    const benefitsIncome = nominalFromRealBase({
      amountReal: benefitsIncomeReal,
      annualIndexRate: indexRate,
      yearsFromBaseline,
    });

    const withdrawals: WithdrawalSources = {
      fhsa: 0,
      rrsp: 0,
      lira: 0,
      nonRegistered: 0,
      tfsa: 0,
    };

    // Mandatory: LIF minimum (if we force LIF in retirement).
    const { minF: lifMinF } = lifMinMaxFactors(ageShingo);
    const lifMinRequired = vars.withdrawals.forceLifFromRetirement ? balances.lira * lifMinF : 0;
    const lifMaxAllowed = balances.lira * lifMaxFactor(ageShingo, vars.withdrawals.lifMode);

    if (lifMinRequired > 0 && balances.lira > 0) {
      const r = withdrawFrom(lifMinRequired, balances.lira, lifMaxAllowed);
      withdrawals.lira += r.withdrawn;
      balances.lira = r.newBalance;
    }

    // Guardrail: OAS clawback ceiling (used to cap taxable drawdowns when enabled)
    const oasClawbackThreshold = getOasClawbackThreshold(year);
    const taxableIncomeCeiling = vars.withdrawals.avoidOasClawback ? Math.max(0, oasClawbackThreshold - 1000) : Infinity;

    // RRIF min starts at 71; otherwise 0. We treat household RRSP as RRIF-like for min-factor purposes.
    const rrifMinRequired =
      ageShingo >= 71
        ? balances.rrsp * rrifMinFactor(ageShingo) * Math.max(0, vars.withdrawals.rrifMinMultiplier)
        : 0;
    const rrifGlideTarget = rrifGlideAmount({
      balance: balances.rrsp,
      age: ageShingo,
      depleteByAge: vars.withdrawals.rrifDepleteByAge,
      frontLoad: vars.withdrawals.rrifFrontLoad,
    });

    // Mandatory RRSP/RRIF withdrawal is capped by the taxable-income ceiling when avoid-clawback is enabled.
    // If the ceiling binds, we defer the remainder (glidepath may not fully deplete by target age).
    const inOasYearsForCeiling = ageShingo >= vars.oasStartAge || ageSarah >= vars.oasStartAge;
    const applyCeiling = vars.withdrawals.avoidOasClawback && inOasYearsForCeiling;

    let ceilingBinding = false;

    const rrspMandatoryRaw = Math.max(rrifMinRequired, rrifGlideTarget);
    let rrspMandatory = rrspMandatoryRaw;

    if (applyCeiling && Number.isFinite(taxableIncomeCeiling) && rrspMandatory > 0) {
      // Estimate current taxable income BEFORE adding any RRSP/RRIF withdrawal.
      // (Uses v2 tax engine + splitting optimizer; planning approximation.)
      const pensionShingo0 = nominalFromRealBase({
        amountReal: DEFAULT_ANCHORS.pensionShingo,
        annualIndexRate: indexRate,
        yearsFromBaseline,
      });
      const pensionSarah0 = nominalFromRealBase({
        amountReal: DEFAULT_ANCHORS.pensionSarah,
        annualIndexRate: indexRate,
        yearsFromBaseline,
      });

      const cppShingo0 = ageShingo >= vars.cppStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.cppShingoAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const cppSarah0 = ageSarah >= vars.cppStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.cppSarahAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const oasShingo0 = ageShingo >= vars.oasStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.oasShingoAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const oasSarah0 = ageSarah >= vars.oasStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.oasSarahAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;

      const baseTax = computeHouseholdTax({
        taxYear: year,
        spouseA: {
          name: "Shingo",
          age: ageShingo,
          incomes: {
            employment: 0,
            pensionDb: pensionShingo0,
            rrspWithdrawal: 0,
            rrifWithdrawal: 0,
            lifWithdrawal: withdrawals.lira,
            cpp: cppShingo0,
            oas: oasShingo0,
            tfsaWithdrawal: 0,
          },
        },
        spouseB: {
          name: "Sarah",
          age: ageSarah,
          incomes: {
            employment: 0,
            pensionDb: pensionSarah0,
            rrspWithdrawal: 0,
            rrifWithdrawal: 0,
            lifWithdrawal: 0,
            cpp: cppSarah0,
            oas: oasSarah0,
            tfsaWithdrawal: 0,
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

      const headroomShingo = Math.max(0, taxableIncomeCeiling - baseTax.spouseA.taxableIncome);
      const headroomSarah = Math.max(0, taxableIncomeCeiling - baseTax.spouseB.taxableIncome);
      // RRSP/RRIF treated as split 50/50 in this model.
      const rrspCeilingCap = vars.tax.enablePensionSplitting ? 2 * Math.min(headroomShingo, headroomSarah) : 2 * Math.min(headroomShingo, headroomSarah);

      if (rrspCeilingCap <= 0) {
        // Still respect the RRIF minimum (if applicable), even if it triggers clawback.
        rrspMandatory = rrifMinRequired;
        ceilingBinding = rrspMandatoryRaw > rrspMandatory;
      } else if (rrspMandatory > rrspCeilingCap) {
        // Cap to ceiling, but never below RRIF minimum.
        rrspMandatory = Math.max(rrifMinRequired, rrspCeilingCap);
        ceilingBinding = rrspMandatoryRaw > rrspMandatory;
      }
    }

    if (rrspMandatory > 0 && balances.rrsp > 0) {
      const r = withdrawFrom(rrspMandatory, balances.rrsp, vars.withdrawals.caps.rrsp);
      withdrawals.rrsp += r.withdrawn;
      balances.rrsp = r.newBalance;
    }

    // --- Iterative solver: top up withdrawals to hit AFTER-TAX spending target.

    let taxableIncomeShingo = 0;
    let taxableIncomeSarah = 0;
    let oasClawbackShingo = 0;
    let oasClawbackSarah = 0;
    let tax = 0;
    let afterTaxCashAvailable = 0;

    const computeTax = () => {
      const pensionShingo = nominalFromRealBase({
        amountReal: DEFAULT_ANCHORS.pensionShingo,
        annualIndexRate: indexRate,
        yearsFromBaseline,
      });
      const pensionSarah = nominalFromRealBase({
        amountReal: DEFAULT_ANCHORS.pensionSarah,
        annualIndexRate: indexRate,
        yearsFromBaseline,
      });

      const cppShingo = ageShingo >= vars.cppStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.cppShingoAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const cppSarah = ageSarah >= vars.cppStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.cppSarahAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const oasShingo = ageShingo >= vars.oasStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.oasShingoAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;
      const oasSarah = ageSarah >= vars.oasStartAge
        ? nominalFromRealBase({ amountReal: vars.withdrawals.oasSarahAnnual, annualIndexRate: indexRate, yearsFromBaseline })
        : 0;

      const res = computeHouseholdTax({
        taxYear: year,
        spouseA: {
          name: "Shingo",
          age: ageShingo,
          incomes: {
            employment: 0,
            pensionDb: pensionShingo,
            rrspWithdrawal: withdrawals.fhsa * 0.5, // FHSA treated as RRSP-like taxable
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
            rrspWithdrawal: withdrawals.fhsa * 0.5,
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

      taxableIncomeShingo = res.spouseA.taxableIncome;
      taxableIncomeSarah = res.spouseB.taxableIncome;
      oasClawbackShingo = res.spouseA.oasClawback;
      oasClawbackSarah = res.spouseB.oasClawback;
      tax = res.household.totalTax;

      const cashIn = guaranteedIncome + benefitsIncome + sumWithdrawals(withdrawals);
      afterTaxCashAvailable = cashIn - tax;

      return res;
    };

    // seed
    let lastTaxRes = computeTax();

    const maxIter = 12;
    let iterations = 0;

    for (let iter = 0; iter < maxIter; iter++) {
      iterations = iter + 1;
      lastTaxRes = computeTax();

      const shortfall = clampToZero(targetAfterTaxNominal - afterTaxCashAvailable);
      if (shortfall <= 1) break;

      // Determine taxable headroom (approx) for guardrails.
      const inOasYears = ageShingo >= vars.oasStartAge || ageSarah >= vars.oasStartAge;
      const applyCeiling = vars.withdrawals.avoidOasClawback && inOasYears;

      const headroomShingo = applyCeiling ? Math.max(0, taxableIncomeCeiling - taxableIncomeShingo) : Infinity;
      const headroomSarah = applyCeiling ? Math.max(0, taxableIncomeCeiling - taxableIncomeSarah) : Infinity;

      const headroomHousehold = applyCeiling
        ? (vars.tax.enablePensionSplitting ? 2 * Math.min(headroomShingo, headroomSarah) : Math.min(headroomShingo, headroomSarah) * 2)
        : Infinity;

      const avgTaxRate = lastTaxRes.household.taxableIncome > 0 ? lastTaxRes.household.totalTax / lastTaxRes.household.taxableIncome : 0;
      const grossUpTaxable = 1 / Math.max(0.5, 1 - Math.min(0.45, Math.max(0, avgTaxRate)));

      // Try to satisfy shortfall using the configured order.
      // We do a single pass each iteration with a mild gross-up.
      let needGross = shortfall;

      // If ceiling is binding, prefer non-taxable sources.
      const avoidTaxableNow = applyCeiling && headroomHousehold < 1000;
      if (avoidTaxableNow) ceilingBinding = true;

      // First attempt: fill with potentially taxable sources but respecting headroom.
      const needForOrder = avoidTaxableNow ? needGross : needGross * grossUpTaxable;

      const remaining = applyWithdrawalOrder({
        need: needForOrder,
        order: vars.withdrawals.order,
        allowTfsa: vars.withdrawals.allowTfsa,
        balances,
        withdrawals,
        caps: vars.withdrawals.caps,
        ageShingo,
        lifMode: vars.withdrawals.lifMode,
        taxableHeadroom: {
          shingo: headroomShingo,
          sarah: headroomSarah,
          household: headroomHousehold,
        },
        avoidTaxable: avoidTaxableNow,
      });

      // If we still have remaining need and we were respecting the ceiling, force non-taxable sources.
      if (remaining > 1 && !avoidTaxableNow) {
        const remaining2 = applyWithdrawalOrder({
          need: remaining,
          order: ["tfsa", "nonRegistered"],
          allowTfsa: vars.withdrawals.allowTfsa,
          balances,
          withdrawals,
          caps: vars.withdrawals.caps,
          ageShingo,
          lifMode: vars.withdrawals.lifMode,
          taxableHeadroom: {
            shingo: Infinity,
            sarah: Infinity,
            household: Infinity,
          },
          avoidTaxable: false,
        });

        if (remaining2 > 1) {
          // infeasible: out of cash
          break;
        }
      }
    }

    // final tax compute
    computeTax();

    const surplusAfterTax = clampToZero(afterTaxCashAvailable - targetAfterTaxNominal);
    const shortfallAfterTax = clampToZero(targetAfterTaxNominal - afterTaxCashAvailable);

    // Surplus routing (after-tax definition)
    const toTfsa = Math.min(surplusAfterTax, tfsaRoom);
    const toNonReg = surplusAfterTax - toTfsa;
    balances.tfsa += toTfsa;
    balances.nonRegistered += toNonReg;
    tfsaRoom -= toTfsa;

    // Apply growth at year-end
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
      targetAfterTaxSpending: targetAfterTaxNominal,
      guaranteedIncome,
      benefitsIncome,
      withdrawals: { ...withdrawals },
      surplusInvestedToTfsa: toTfsa,
      surplusInvestedToNonReg: toNonReg,
      endBalances: { ...balances },
      debug: {
        targetAfterTaxNominal,
        targetAfterTaxReal,
        taxableIncomeShingo,
        taxableIncomeSarah,
        tax,
        oasClawbackShingo,
        oasClawbackSarah,
        oasClawbackThreshold,
        taxableIncomeCeiling,
        ceilingBinding,
        lifMinRequired,
        lifMaxAllowed,
        lifMode: vars.withdrawals.lifMode,
        rrifMinRequired,
        rrifGlideTarget,
        iterations,
        afterTaxCashAvailable,
        surplusAfterTax,
        shortfallAfterTax,
      },
    });
  }

  return rows;
}
