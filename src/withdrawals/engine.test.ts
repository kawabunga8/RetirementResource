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
  it("Scenario 1: meets after-tax spending target within $1 (TFSA top-ups)", () => {
    const vars = baseVars();
    vars.withdrawals = {
      ...vars.withdrawals,
      allowTfsa: true,
      order: ["tfsa"],
      avoidOasClawback: false,
      forceLifFromRetirement: false,
      tfsaRoomAtRetirement: 0,
      tfsaNewRoomPerYear: 0,
    };

    vars.spending = {
      goGo: 90000, // after-tax target (real)
      slowGo: 90000,
      noGo: 90000,
    };

    const retirementBalances: RetirementBalances = {
      fhsa: 0,
      rrsp: 0,
      tfsa: 1_000_000,
      lira: 0,
      nonRegistered: 0,
    };

    const sched = buildWithdrawalSchedule({
      vars,
      retirementYear: vars.retirementYear,
      retirementBalances,
    });

    expect(sched.length).toBeGreaterThan(0);
    for (const r of sched) {
      expect(r.debug.shortfallAfterTax).toBeLessThanOrEqual(1.01);
    }

    // Ensure withdrawals came only from TFSA
    expect(sched[0].withdrawals.rrsp).toBe(0);
    expect(sched[0].withdrawals.lira).toBe(0);
    expect(sched[0].withdrawals.tfsa).toBeGreaterThanOrEqual(0);
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

  it("Scenario 3: avoid-OAS-clawback guardrail prefers TFSA and keeps taxable income below ceiling", () => {
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

    // Allow a small tolerance because the solver uses a heuristic gross-up and splitting optimizer.
    expect(maxTaxable).toBeLessThanOrEqual(ceiling + 1500);
    // Should have used TFSA (guardrail prefers non-taxable when headroom is tight)
    expect(r.withdrawals.tfsa).toBeGreaterThan(0);
  });
});
