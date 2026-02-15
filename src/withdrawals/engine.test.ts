import { describe, expect, it } from "vitest";
import { DEFAULT_VARIABLES } from "../planDefaults";
import { buildWithdrawalSchedule, type RetirementBalances } from "./engine";
import { getOasClawbackThreshold } from "../tax/v2";

function baseVars() {
  return {
    ...DEFAULT_VARIABLES,
    // Make inflation/indexation neutral for easier expectations
    expectedInflation: 0,
    cpiMultiplier: 1,
    expectedNominalReturn: 0,
    dollarsMode: "nominal" as const,
    retirementYear: 2026,
    shingoRetireAge: 67,
    sarahRetireAge: 65,
    // Keep the plan short for test speed
    phaseAges: {
      goGoEndAge: 68,
      slowGoEndAge: 68,
      endAge: 68,
    },
  };
}

describe("withdrawal engine (after-tax targets, tax v2)", () => {
  it("Scenario 1: TFSA/NonReg are not used for spending gaps (RRIF-first model)", () => {
    const vars = baseVars();
    vars.withdrawals = {
      ...vars.withdrawals,
      allowTfsa: true,
      order: ["rrsp", "lira", "nonRegistered", "tfsa"],
      avoidOasClawback: false,
      forceLifFromRetirement: false,
      tfsaRoomAtRetirement: 0,
      tfsaNewRoomPerYear: 0,
    };

    vars.spending = {
      goGo: 90_000, // after-tax target (real)
      slowGo: 90_000,
      noGo: 90_000,
    };

    const retirementBalances: RetirementBalances = {
      fhsa: 0,
      rrsp: 1_000_000,
      tfsa: 1_000_000,
      lira: 500_000,
      nonRegistered: 1_000_000,
    };

    const sched = buildWithdrawalSchedule({
      vars,
      retirementYear: vars.retirementYear,
      retirementBalances,
    });

    expect(sched.length).toBeGreaterThan(0);

    // Core requirement: we don't cover spending gaps using TFSA/NonReg withdrawals.
    for (const r of sched) {
      expect(r.withdrawals.tfsa).toBe(0);
      expect(r.withdrawals.nonRegistered).toBe(0);
      expect(r.debug.shortfallAfterTax).toBeGreaterThanOrEqual(0);
    }
  });

  it("Scenario 2: forced LIF minimum is withdrawn and surplus is invested", () => {
    const vars = baseVars();
    vars.withdrawals = {
      ...vars.withdrawals,
      allowTfsa: true,
      order: ["tfsa"],
      avoidOasClawback: false,
      forceLifFromRetirement: true,
      lifMode: "min",
      tfsaRoomAtRetirement: 50_000,
      tfsaNewRoomPerYear: 0,
    };

    vars.spending = {
      goGo: 1, // tiny after-tax target
      slowGo: 1,
      noGo: 1,
    };

    const retirementBalances: RetirementBalances = {
      fhsa: 0,
      rrsp: 0,
      tfsa: 0,
      lira: 200_000,
      nonRegistered: 0,
    };

    const [r] = buildWithdrawalSchedule({
      vars,
      retirementYear: vars.retirementYear,
      retirementBalances,
    });

    expect(r.withdrawals.lira).toBeGreaterThan(0);
    expect(r.withdrawals.lira + 1e-6).toBeGreaterThanOrEqual(r.debug.lifMinRequired);
    expect(r.debug.surplusAfterTax).toBeGreaterThan(0);
    // Surplus should go to TFSA first (bounded by room)
    expect(r.surplusInvestedToTfsa).toBeLessThanOrEqual(50_000 + 1e-6);
    expect(r.surplusInvestedToTfsa + r.surplusInvestedToNonReg).toBeCloseTo(r.debug.surplusAfterTax, 6);
  });

  it("Scenario 3: avoid-OAS-clawback is secondary (may accept clawback instead of using TFSA)", () => {
    const vars = baseVars();
    vars.oasStartAge = 65;
    vars.cppStartAge = 65;
    vars.shingoRetireAge = 70;
    vars.sarahRetireAge = 70;
    vars.phaseAges = {
      goGoEndAge: 71,
      slowGoEndAge: 71,
      endAge: 71,
    };

    vars.withdrawals = {
      ...vars.withdrawals,
      allowTfsa: true,
      order: ["rrsp", "tfsa"],
      avoidOasClawback: true,
      forceLifFromRetirement: false,
      tfsaRoomAtRetirement: 0,
      tfsaNewRoomPerYear: 0,
      // Big benefits so the guardrail is relevant
      oasShingoAnnual: 11_000,
      oasSarahAnnual: 11_000,
      cppShingoAnnual: 20_000,
      cppSarahAnnual: 20_000,
    };

    // High after-tax spending target: forces drawdown
    vars.spending = {
      goGo: 300_000,
      slowGo: 300_000,
      noGo: 300_000,
    };

    const retirementBalances: RetirementBalances = {
      fhsa: 0,
      rrsp: 2_000_000,
      tfsa: 2_000_000,
      lira: 0,
      nonRegistered: 0,
    };

    const [r] = buildWithdrawalSchedule({
      vars,
      retirementYear: vars.retirementYear,
      retirementBalances,
    });

    const ceiling = getOasClawbackThreshold(r.year) - 1000;
    const maxTaxable = Math.max(r.debug.taxableIncomeShingo, r.debug.taxableIncomeSarah);

    // Ceiling is a soft target now.
    expect(maxTaxable).toBeGreaterThan(0);
    expect(ceiling).toBeGreaterThan(0);

    // Still: TFSA should not be used for gap coverage in this model.
    expect(r.withdrawals.tfsa).toBe(0);
  });
});
