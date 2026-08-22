import { computeHouseholdTax, getOasClawbackThreshold } from "../tax/v2";
import {
  cppAmountForStartAge,
  oasAmountForStartAge,
  effectiveCppStartAge,
  effectiveOasStartAge,
} from "../benefits";
import type { Anchors, LifMode, Variables, WithdrawalOrder } from "../planDefaults";

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

  // Pass-2 glidepath helpers
  startBalances: RetirementBalances;
  extraRrifPlanned: number;
  /**
   * RRSP withdrawn to cover spending and minimums, BEFORE the levelling overlay.
   * The overlay solver needs this to re-derive its baseline on each refinement;
   * reading withdrawals.rrsp would double-count the overlay it just applied.
   */
  rrspBeforeOverlay: number;

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

// clamp01 removed (no longer needed)

/**
 * `cap` is a hard ceiling on the amount withdrawn. Use NO_CAP (Infinity) for
 * "unlimited" — a cap of 0 genuinely means "withdraw nothing".
 *
 * (This used to treat 0 as "no cap", which meant a binding OAS ceiling of $0 of
 * headroom silently became *unlimited* headroom for the LIRA.)
 */
const NO_CAP = Infinity;

/** Plan config uses 0 to mean "no cap"; convert to the real sentinel. */
function capFromConfig(configured: number) {
  return configured > 0 ? configured : NO_CAP;
}

function withdrawFrom(amount: number, balance: number, cap: number) {
  if (amount <= 0) return { withdrawn: 0, remainingNeed: 0, newBalance: balance };

  const allowed = Math.min(amount, Math.max(0, cap));
  const withdrawn = Math.min(allowed, Math.max(0, balance));
  return {
    withdrawn,
    remainingNeed: amount - withdrawn,
    newBalance: balance - withdrawn,
  };
}

/**
 * Age at which RRIF/LIF minimum withdrawals become mandatory. Conversion happens
 * by the end of the year you turn 71; the first required payment is the year you
 * turn 72.
 */
const MANDATORY_MIN_START_AGE = 72;

let RRIF_STATUTORY_FACTORS: Record<number, number> = {
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

export function updateRrifFactorsFromDb(factors: Record<number, number>) {
  // Only update the statutory range (71+); formula range (≤70) is derived.
  RRIF_STATUTORY_FACTORS = { ...RRIF_STATUTORY_FACTORS, ...factors };
}

export function rrifMinFactor(age: number) {
  if (age <= 0) return 0;
  if (age <= 70) return 1 / (90 - age);
  if (age >= 95) return 0.2;
  return RRIF_STATUTORY_FACTORS[age] ?? 0;
}

let BC_LIF_MAX_PCT_BY_AGE: Record<number, number> = {
  50: 0.0627,
  51: 0.0631,
  52: 0.0635,
  53: 0.064,
  54: 0.0645,
  55: 0.0651,
  56: 0.0657,
  57: 0.0663,
  58: 0.067,
  59: 0.0677,
  60: 0.0685,
  61: 0.0694,
  62: 0.0704,
  63: 0.0714,
  64: 0.0726,
  65: 0.0738,
  66: 0.0752,
  67: 0.0767,
  68: 0.0783,
  69: 0.0802,
  70: 0.0822,
  71: 0.0845,
  72: 0.0871,
  73: 0.09,
  74: 0.0934,
  75: 0.0971,
  76: 0.1015,
  77: 0.1066,
  78: 0.1125,
  79: 0.1196,
  80: 0.1282,
  81: 0.1387,
  82: 0.1519,
  83: 0.169,
  84: 0.1919,
  85: 0.224,
  86: 0.2723,
  87: 0.3529,
  88: 0.5146,
};

export function updateBcLifMaxFromDb(table: Record<number, number>) {
  BC_LIF_MAX_PCT_BY_AGE = { ...BC_LIF_MAX_PCT_BY_AGE, ...table };
}

function bcLifMaxPct(age: number) {
  if (age >= 89) return 1;
  if (age < 50) return BC_LIF_MAX_PCT_BY_AGE[50]!;
  return BC_LIF_MAX_PCT_BY_AGE[age] ?? BC_LIF_MAX_PCT_BY_AGE[50]!;
}

function lifMinMaxFactors(age: number) {
  // BC LIF planning model:
  // - Minimum: use CRA RRIF minimum factors (common approximation for minimum).
  // - Maximum: BC LIF maximum percentage table (BCFSA).
  const minF = rrifMinFactor(age);
  const maxF = bcLifMaxPct(age);
  return { minF, maxF };
}

function lifTargetFactor(age: number, mode: LifMode) {
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

// (rrifGlideAmount removed: RRIF glidepath is now handled as a global, two-pass overlay)

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
  /**
   * Dollars of LIF allowance still unused this year. The BC LIF maximum is an
   * ANNUAL limit, so any mandatory LIF withdrawal already taken has to be
   * subtracted before the solver tops up from the same account.
   */
  lifRemainingThisYear: number;
}) {
  let need = params.need;

  for (const src of params.order) {
    if (need <= 0) break;

    if (src === "pension") continue;
    if (src === "tfsa" && !params.allowTfsa) continue;

    if (src === "fhsa") {
      // treat FHSA as taxable (RRSP-like) in drawdown planning.
      const cap = Math.min(capFromConfig(params.caps.fhsa), params.taxableHeadroom.household);
      const r = withdrawFrom(need, params.balances.fhsa, cap);
      params.withdrawals.fhsa += r.withdrawn;
      params.balances.fhsa = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "rrsp") {
      // household RRSP assumed split 50/50 for taxable-income purposes.
      const cap = Math.min(capFromConfig(params.caps.rrsp), params.taxableHeadroom.household);
      const r = withdrawFrom(need, params.balances.rrsp, cap);
      params.withdrawals.rrsp += r.withdrawn;
      params.balances.rrsp = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "lira") {
      // Never exceed the BC LIF maximum, the configured cap, or the taxable ceiling.
      const lifMax = params.balances.lira * lifTargetFactor(params.ageShingo, params.lifMode);
      const cap = Math.min(
        capFromConfig(params.caps.lira),
        lifMax,
        Math.max(0, params.lifRemainingThisYear),
        params.taxableHeadroom.shingo
      );

      const r = withdrawFrom(need, params.balances.lira, cap);
      params.withdrawals.lira += r.withdrawn;
      params.balances.lira = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "nonRegistered") {
      // Treated as after-tax cash; tax drag is applied to its growth instead.
      const r = withdrawFrom(need, params.balances.nonRegistered, capFromConfig(params.caps.nonRegistered));
      params.withdrawals.nonRegistered += r.withdrawn;
      params.balances.nonRegistered = r.newBalance;
      need = r.remainingNeed;
    }

    if (src === "tfsa") {
      const r = withdrawFrom(need, params.balances.tfsa, capFromConfig(params.caps.tfsa));
      params.withdrawals.tfsa += r.withdrawn;
      params.balances.tfsa = r.newBalance;
      need = r.remainingNeed;
    }
  }

  return need;
}

const FHSA_SHINGO_START_YEAR = 2024;
const FHSA_MAX_YEARS = 15;
const FHSA_SHINGO_FORCE_ROLL_YEAR = FHSA_SHINGO_START_YEAR + FHSA_MAX_YEARS; // 2039

export function buildWithdrawalSchedule(params: {
  vars: Variables;
  anchors: Anchors;
  retirementYear: number;
  retirementBalances: RetirementBalances;
}) {
  const { vars, anchors } = params;

  const indexRate = vars.expectedInflation * vars.cpiMultiplier;
  // Each spouse's pension indexes at its own rate. Summing them and applying a
  // single rate cannot represent the common case of one indexed plan and one
  // that is not.
  const pensionIndexShingo = vars.pensionIndexRateShingo ?? vars.pensionIndexRate;
  const pensionIndexSarah = vars.pensionIndexRateSarah ?? vars.pensionIndexRate;

  const retireAgeShingo = vars.shingoRetireAge;
  const retireAgeSarah = vars.sarahRetireAge;

  // CPP/OAS start ages, clamped to what the programs allow (CPP 60-70, OAS 65-70).
  const cppStartAge = effectiveCppStartAge(vars.cppStartAge);
  const oasStartAge = effectiveOasStartAge(vars.oasStartAge);

  // Stored amounts are quoted at age 70. Apply the actuarial adjustment so that
  // moving the start age actually changes the size of the cheque, not just its timing.
  const cppShingoReal = cppAmountForStartAge(vars.withdrawals.cppShingoAnnual, cppStartAge);
  const cppSarahReal = cppAmountForStartAge(vars.withdrawals.cppSarahAnnual, cppStartAge);
  const oasShingoReal = oasAmountForStartAge(vars.withdrawals.oasShingoAnnual, oasStartAge);
  const oasSarahReal = oasAmountForStartAge(vars.withdrawals.oasSarahAnnual, oasStartAge);

  const yearsInPlan = Math.max(0, vars.phaseAges.endAge - Math.min(retireAgeShingo, retireAgeSarah) + 1);

  type ExtraPlan = Record<number, number>; // year -> extra RRIF/RRSP withdrawal (nominal dollars)

  const simulate = (extraPlan: ExtraPlan): WithdrawalScheduleRow[] => {
    const rows: WithdrawalScheduleRow[] = [];

    let balances: RetirementBalances = { ...params.retirementBalances };
    let tfsaRoom = Math.max(0, vars.withdrawals.tfsaRoomAtRetirement);

    for (let i = 0; i < yearsInPlan; i++) {
      const year = params.retirementYear + i;

      // FHSA rollover rules:
      // - If toggle is ON: roll FHSA into RRSP at retirement year.
      // - If toggle is OFF: keep FHSA separate, but force rollover after 15 years from Shingo FHSA start.
      if (vars.withdrawals.rollFhsaIntoRrspAtRetirement && year === params.retirementYear && balances.fhsa > 0) {
        balances = {
          ...balances,
          rrsp: balances.rrsp + balances.fhsa,
          fhsa: 0,
        };
      }

      if (!vars.withdrawals.rollFhsaIntoRrspAtRetirement && year >= FHSA_SHINGO_FORCE_ROLL_YEAR && balances.fhsa > 0) {
        balances = {
          ...balances,
          rrsp: balances.rrsp + balances.fhsa,
          fhsa: 0,
        };
      }

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

      const yearsFromBaseline = year - anchors.baselineYear;
      // Spending targets are defined as REAL (today dollars). Convert using FULL inflation (not partial CPI).
      const targetAfterTaxNominal = nominalFromRealBase({
        amountReal: targetAfterTaxReal,
        annualIndexRate: vars.expectedInflation,
        yearsFromBaseline,
      });

      const pensionShingoNominal = nominalFromRealBase({
        amountReal: anchors.pensionShingo,
        annualIndexRate: pensionIndexShingo,
        yearsFromBaseline,
      });
      const pensionSarahNominal = nominalFromRealBase({
        amountReal: anchors.pensionSarah,
        annualIndexRate: pensionIndexSarah,
        yearsFromBaseline,
      });
      const guaranteedIncome = pensionShingoNominal + pensionSarahNominal;

      // CPP/OAS for this year, in nominal dollars. Computed once and reused by
      // every tax pass below (previously duplicated in three places).
      const benefitNominal = (amountReal: number, hasStarted: boolean) =>
        hasStarted
          ? nominalFromRealBase({ amountReal, annualIndexRate: indexRate, yearsFromBaseline })
          : 0;

      const cppShingoNominal = benefitNominal(cppShingoReal, ageShingo >= cppStartAge);
      const cppSarahNominal = benefitNominal(cppSarahReal, ageSarah >= cppStartAge);
      const oasShingoNominal = benefitNominal(oasShingoReal, ageShingo >= oasStartAge);
      const oasSarahNominal = benefitNominal(oasSarahReal, ageSarah >= oasStartAge);

      const benefitsIncome =
        cppShingoNominal + cppSarahNominal + oasShingoNominal + oasSarahNominal;

      const withdrawals: WithdrawalSources = {
        fhsa: 0,
        rrsp: 0,
        lira: 0,
        nonRegistered: 0,
        tfsa: 0,
      };

      const startBalances: RetirementBalances = { ...balances };

      // LIF withdrawal policy.
      // When forceLifFromRetirement is enabled, we treat lifMode (min/mid/max) as the planned annual withdrawal factor.
      // (This makes the min/mid/max selection actually change the LIF remaining balance over time.)
      const { minF: lifMinF } = lifMinMaxFactors(ageShingo);
      // A LIRA must convert to a LIF by 31 Dec of the year you turn 71, and the
      // first mandatory minimum falls in the year you turn 72. That is the law,
      // not a planning preference, so it applies regardless of the toggle.
      const lifMandatory = ageShingo >= MANDATORY_MIN_START_AGE;
      const lifMinRequired =
        vars.withdrawals.forceLifFromRetirement || lifMandatory ? balances.lira * lifMinF : 0;
      // BC LIF maximum annual withdrawal is the greater of:
      // - the preceding year's investment return in the LIF (planning approx: prior balance * expectedNominalReturn)
      // - beginning-of-year balance × BC max percentage table
      const prevYearInvestmentReturn = i === 0 ? 0 : startBalances.lira * Math.max(0, vars.expectedNominalReturn);
      const lifMaxAllowed = Math.max(prevYearInvestmentReturn, balances.lira * bcLifMaxPct(ageShingo));

      const lifPlanned = vars.withdrawals.forceLifFromRetirement
        ? balances.lira * lifTargetFactor(ageShingo, vars.withdrawals.lifMode)
        : 0;

      // Always respect minimums, and never exceed the BC maximum.
      const lifTarget = Math.min(lifMaxAllowed, Math.max(lifMinRequired, lifPlanned));

      if (lifTarget > 0 && balances.lira > 0) {
        const r = withdrawFrom(lifTarget, balances.lira, capFromConfig(vars.withdrawals.caps.lira));
        withdrawals.lira += r.withdrawn;
        balances.lira = r.newBalance;
      }

      const extraThisYear = Math.max(0, extraPlan[year] ?? 0);

      // Guardrail: OAS clawback ceiling (used to cap taxable drawdowns when enabled)
      const oasClawbackThreshold = getOasClawbackThreshold(year, vars.expectedInflation);
      const taxableIncomeCeiling = vars.withdrawals.avoidOasClawback ? Math.max(0, oasClawbackThreshold - 1000) : Infinity;

      // No minimum is required in the year the RRIF is established (age 71); the
      // first mandatory withdrawal is in the year you turn 72.
      // We treat the household RRSP as RRIF-like for min-factor purposes.
      const rrifMinRequired =
        ageShingo >= MANDATORY_MIN_START_AGE
          ? balances.rrsp * rrifMinFactor(ageShingo) * Math.max(0, vars.withdrawals.rrifMinMultiplier)
          : 0;

      // Mandatory RRSP/RRIF withdrawal is capped by the taxable-income ceiling when avoid-clawback is enabled.
      // NOTE: in the depletion year we force full depletion regardless of ceilings.
      const inOasYearsForCeiling = ageShingo >= oasStartAge || ageSarah >= oasStartAge;
      const applyCeiling = vars.withdrawals.avoidOasClawback && inOasYearsForCeiling;

      let ceilingBinding = false;

      // Mandatory RRSP/RRIF withdrawal:
      // - RRIF minimum in most years
      // - HARD force full depletion in the depletion year
      const isDepletionYear = ageShingo >= vars.withdrawals.rrifDepleteByAge;

      const rrspMandatoryRaw = isDepletionYear ? balances.rrsp : rrifMinRequired;
      let rrspMandatory = rrspMandatoryRaw;

      if (!isDepletionYear && applyCeiling && Number.isFinite(taxableIncomeCeiling) && rrspMandatory > 0) {
        // Estimate current taxable income BEFORE adding any RRSP/RRIF withdrawal.
        // (Uses v2 tax engine + splitting optimizer; planning approximation.)

        const baseTax = computeHouseholdTax({
          taxYear: year,
          annualInflation: vars.expectedInflation,
          spouseA: {
            name: "Shingo",
            age: ageShingo,
            incomes: {
              employment: 0,
              pensionDb: pensionShingoNominal,
              rrspWithdrawal: 0,
              rrifWithdrawal: 0,
              lifWithdrawal: withdrawals.lira,
              cpp: cppShingoNominal,
              oas: oasShingoNominal,
              tfsaWithdrawal: 0,
            },
          },
          spouseB: {
            name: "Sarah",
            age: ageSarah,
            incomes: {
              employment: 0,
              pensionDb: pensionSarahNominal,
              rrspWithdrawal: 0,
              rrifWithdrawal: 0,
              lifWithdrawal: 0,
              cpp: cppSarahNominal,
              oas: oasSarahNominal,
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
        const rrspCeilingCap = 2 * Math.min(headroomShingo, headroomSarah);

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
        // In depletion year, force full depletion regardless of caps.
        const cap = isDepletionYear
          ? NO_CAP
          : Math.max(0, capFromConfig(vars.withdrawals.caps.rrsp) - withdrawals.rrsp);
        const r = withdrawFrom(rrspMandatory, balances.rrsp, cap);
        withdrawals.rrsp += r.withdrawn;
        balances.rrsp = r.newBalance;
      }

      // --- Iterative solver: top up withdrawals to hit AFTER-TAX spending target.
      // TFSA and non-registered are NEVER used to cover spending gaps in this model.

      let taxableIncomeShingo = 0;
      let taxableIncomeSarah = 0;
      let oasClawbackShingo = 0;
      let oasClawbackSarah = 0;
      let tax = 0;
      let afterTaxCashAvailable = 0;

      const computeTax = () => {

        const res = computeHouseholdTax({
          taxYear: year,
          annualInflation: vars.expectedInflation,
          spouseA: {
            name: "Shingo",
            age: ageShingo,
            incomes: {
              employment: 0,
              pensionDb: pensionShingoNominal,
              rrspWithdrawal: withdrawals.fhsa * 0.5, // FHSA treated as RRSP-like taxable
              rrifWithdrawal: withdrawals.rrsp * 0.5,
              lifWithdrawal: withdrawals.lira,
              cpp: cppShingoNominal,
              oas: oasShingoNominal,
              tfsaWithdrawal: 0,
            },
          },
          spouseB: {
            name: "Sarah",
            age: ageSarah,
            incomes: {
              employment: 0,
              pensionDb: pensionSarahNominal,
              rrspWithdrawal: withdrawals.fhsa * 0.5,
              rrifWithdrawal: withdrawals.rrsp * 0.5,
              lifWithdrawal: 0,
              cpp: cppSarahNominal,
              oas: oasSarahNominal,
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

        const shortfall = Math.max(0,targetAfterTaxNominal - afterTaxCashAvailable);
        if (shortfall <= 1) break;

        // Determine taxable headroom (approx) for guardrails.
        const inOasYears = ageShingo >= oasStartAge || ageSarah >= oasStartAge;
        const applyCeiling2 = vars.withdrawals.avoidOasClawback && inOasYears;

        const headroomShingo = applyCeiling2 ? Math.max(0, taxableIncomeCeiling - taxableIncomeShingo) : Infinity;
        const headroomSarah = applyCeiling2 ? Math.max(0, taxableIncomeCeiling - taxableIncomeSarah) : Infinity;

        // With pension splitting we can move eligible income to whichever spouse
        // has room, so the household can absorb the SUM of both headrooms.
        // Without it, RRSP/RRIF income is modelled 50/50, so the binding
        // constraint is twice the SMALLER headroom.
        const headroomHousehold = applyCeiling2
          ? (vars.tax.enablePensionSplitting
              ? headroomShingo + headroomSarah
              : 2 * Math.min(headroomShingo, headroomSarah))
          : Infinity;

        const avgTaxRate = lastTaxRes.household.taxableIncome > 0 ? lastTaxRes.household.totalTax / lastTaxRes.household.taxableIncome : 0;
        const grossUpTaxable = 1 / Math.max(0.5, 1 - Math.min(0.45, Math.max(0, avgTaxRate)));

        // Requirement: cover any remaining spending gap using RRIF/RRSP first.
        const orderForGap = [
          "rrsp" as const,
          ...vars.withdrawals.order.filter((o) => o !== "rrsp" && o !== "tfsa" && o !== "nonRegistered"),
        ];

        // Record that the OAS ceiling is out of room. We still fund the spending
        // target from taxable sources rather than manufacturing a shortfall --
        // the ceiling is a soft guardrail, not a hard constraint -- but the flag
        // surfaces in the debug output so the year is visibly constrained.
        if (applyCeiling2 && headroomHousehold < 1000) ceilingBinding = true;

        const needForOrder = shortfall * grossUpTaxable;

        const remaining = applyWithdrawalOrder({
          need: needForOrder,
          order: orderForGap,
          allowTfsa: false,
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
          lifRemainingThisYear: Math.max(0, lifMaxAllowed - withdrawals.lira),
        });

        if (remaining > 1) {
          // infeasible: out of cash
          break;
        }
      }

      // final tax compute (spending-gap solution)
      computeTax();

      // Extra RRIF overlay (global plan): withdraw additional RRIF AFTER the spending gap is covered,
      // and invest the resulting after-tax surplus (TFSA first, then NonReg).
      const rrspBeforeOverlay = withdrawals.rrsp;

      if (extraThisYear > 0 && balances.rrsp > 0) {
        const cap = Math.max(0, capFromConfig(vars.withdrawals.caps.rrsp) - withdrawals.rrsp);

        const r = withdrawFrom(extraThisYear, balances.rrsp, cap);
        withdrawals.rrsp += r.withdrawn;
        balances.rrsp = r.newBalance;
        computeTax();
      }

      const surplusAfterTax = Math.max(0,afterTaxCashAvailable - targetAfterTaxNominal);
      const shortfallAfterTax = Math.max(0,targetAfterTaxNominal - afterTaxCashAvailable);

      // Surplus routing (after-tax definition)
      const toTfsa = Math.min(surplusAfterTax, tfsaRoom);
      const toNonReg = surplusAfterTax - toTfsa;
      balances.tfsa += toTfsa;
      balances.nonRegistered += toNonReg;
      tfsaRoom -= toTfsa;

      // Apply growth at year-end
      // Non-registered growth is taxed as it is earned, so it compounds at a
      // reduced rate. Registered accounts grow untaxed.
      const nonRegReturn =
        vars.expectedNominalReturn - Math.max(0, vars.nonRegTaxDragRate ?? 0);

      balances = {
        fhsa: balances.fhsa * (1 + vars.expectedNominalReturn),
        rrsp: balances.rrsp * (1 + vars.expectedNominalReturn),
        tfsa: balances.tfsa * (1 + vars.expectedNominalReturn),
        lira: balances.lira * (1 + vars.expectedNominalReturn),
        nonRegistered: balances.nonRegistered * (1 + Math.max(-1, nonRegReturn)),
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
          rrifGlideTarget: 0,
          iterations,
          afterTaxCashAvailable,
          surplusAfterTax,
          shortfallAfterTax,
          startBalances,
          extraRrifPlanned: extraThisYear,
          rrspBeforeOverlay,
        },
      });
    }

    return rows;
  };

  // Pass 1: cover spending gaps (RRIF-first), with hard depletion-year withdrawal.
  const pass1 = simulate({});

  const depleteAge = vars.withdrawals.rrifDepleteByAge;
  if (!pass1.find((r) => r.ageShingo >= depleteAge)) return pass1;

  // If the user has supplied per-year manual overrides, bypass the solver entirely.
  const manualOverrides = vars.withdrawals.rrspExtraByYear ?? {};
  if (Object.keys(manualOverrides).length > 0) {
    const manualPlan: ExtraPlan = {};
    const depletionYear = pass1.find((r) => r.ageShingo >= depleteAge)!.year;
    for (const r of pass1) {
      if (r.year >= params.retirementYear && r.year < depletionYear) {
        const v = manualOverrides[String(r.year)];
        if (v != null) manualPlan[r.year] = Math.max(0, v);
      }
    }
    return simulate(manualPlan);
  }

  /**
   * Solve for a levelling overlay that drives the RRSP to ~0 by the depletion
   * year, using `rows` to estimate what will be withdrawn for spending anyway.
   */
  const solveExtraPlan = (rows: WithdrawalScheduleRow[]): ExtraPlan | null => {
    const depletionRow = rows.find((r) => r.ageShingo >= depleteAge);
    if (!depletionRow) return null;
    const depletionYear = depletionRow.year;

    const years = rows
      .filter((r) => r.year >= params.retirementYear && r.year < depletionYear)
      .map((r) => r.year);
    if (years.length === 0) return null;

    const f = Math.max(0, Math.min(1, vars.withdrawals.rrifFrontLoad));
    const ratio = 1 + 1.0 * f; // 1 = even, 2 = modestly front-loaded

    const rawWeights = years.map((_, idx) => (ratio === 1 ? 1 : Math.pow(ratio, years.length - 1 - idx)));
    const avgW = rawWeights.reduce((a, b) => a + b, 0) / rawWeights.length;
    const weights = rawWeights.map((w) => (avgW > 0 ? w / avgW : 1)); // average weight = 1

    // Baseline = what gets withdrawn for spending and minimums WITHOUT the overlay.
    const baseByYear = new Map<number, number>();
    for (const r of rows) {
      if (r.year >= params.retirementYear && r.year < depletionYear) {
        baseByYear.set(r.year, Math.max(0, r.debug.rrspBeforeOverlay));
      }
    }

    const growth = Math.max(0, vars.expectedNominalReturn);
    const B0 = Math.max(
      0,
      params.retirementBalances.rrsp +
        (vars.withdrawals.rollFhsaIntoRrspAtRetirement ? params.retirementBalances.fhsa : 0)
    );

    const endBalanceFor = (A: number) => {
      let bal = B0;
      for (let i = 0; i < years.length; i++) {
        const base = baseByYear.get(years[i]) ?? 0;
        const w = Math.min(bal, base + Math.max(0, A * weights[i]));
        bal = (bal - w) * (1 + growth);
      }
      return bal;
    };

    let lo = 0;
    let hi = Math.max(1, B0);
    while (endBalanceFor(hi) > 1 && hi < B0 * 10) hi *= 1.5;
    for (let iter = 0; iter < 40; iter++) {
      const mid = (lo + hi) / 2;
      if (endBalanceFor(mid) > 1) lo = mid;
      else hi = mid;
    }

    const plan: ExtraPlan = {};
    for (let i = 0; i < years.length; i++) plan[years[i]] = Math.max(0, hi * weights[i]);
    return plan;
  };

  /**
   * Refine the overlay until the RRSP really is drained by the depletion year.
   *
   * A single pass is not enough. The solver estimates the overlay from a
   * simulation whose spending withdrawals were produced WITHOUT that overlay;
   * once the overlay is applied the balance trajectory changes, the baseline it
   * assumed no longer holds, and a lump is left for the depletion year to
   * absorb -- a spike in taxable income exactly where the OAS clawback bites.
   *
   * Each round re-derives the baseline from the previous full simulation, so
   * the estimate converges on what the engine actually does. Four rounds is
   * ample; the loop exits as soon as the leftover is immaterial.
   */
  const LEVELLING_TOLERANCE = 1000; // dollars of RRSP left at the depletion year
  const MAX_REFINEMENTS = 4;

  let rows = pass1;
  for (let round = 0; round < MAX_REFINEMENTS; round++) {
    const plan = solveExtraPlan(rows);
    if (!plan) break;

    const next = simulate(plan);
    rows = next;

    const dep = next.find((r) => r.ageShingo >= depleteAge);
    if (!dep || dep.debug.startBalances.rrsp <= LEVELLING_TOLERANCE) break;
  }

  return rows;
}
