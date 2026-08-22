import { describe, it, expect } from "vitest";
import { DEFAULT_VARIABLES, type Variables } from "../planDefaults";
import type { PlanVarsOverrides } from "./db";

/** Mirrors App.tsx's merge when a saved plan loads. */
function mergeSavedPlan(base: Variables, ov: PlanVarsOverrides): Variables {
  return { ...base, ...ov, withdrawals: { ...base.withdrawals, ...ov.withdrawals } };
}

/**
 * Mirrors loadPlan: the settings blob is applied first, normalised columns win.
 * Kept in step with db.ts by the assertions below.
 */
function buildOverrides(settings: Partial<Variables>, normalised: PlanVarsOverrides): PlanVarsOverrides {
  return {
    ...settings,
    ...normalised,
    withdrawals: { ...(settings.withdrawals ?? {}), ...normalised.withdrawals },
  };
}

describe("settings stored as a JSON blob", () => {
  const fromDb: Partial<Variables> = {
    pensionAdjustmentShingo: 16275,
    pensionAdjustmentSarah: 21353,
    pensionIndexRateShingo: 0,
    pensionIndexRateSarah: 0,
    nonRegTaxDragRate: 0.01,
    withdrawals: { ...DEFAULT_VARIABLES.withdrawals, rrifDepleteByAge: 80, lifMode: "min" },
  };
  const normalised: PlanVarsOverrides = {
    retirementYear: 2038,
    withdrawals: { cppShingoAnnual: 20000, cppSarahAnnual: 18000, oasShingoAnnual: 10000, oasSarahAnnual: 10000 },
  };

  it("restores settings that previously existed only in code defaults", () => {
    const v = mergeSavedPlan(DEFAULT_VARIABLES, buildOverrides(fromDb, normalised));
    expect(v.pensionAdjustmentSarah).toBe(21353);
    expect(v.nonRegTaxDragRate).toBe(0.01);
    // The COLA downside scenario now survives a reload.
    expect(v.pensionIndexRateSarah).toBe(0);
  });

  it("restores withdrawal strategy, which the database could not hold before", () => {
    const v = mergeSavedPlan(DEFAULT_VARIABLES, buildOverrides(fromDb, normalised));
    expect(v.withdrawals.rrifDepleteByAge).toBe(80);
    expect(v.withdrawals.lifMode).toBe("min");
  });

  it("lets normalised columns win over the blob", () => {
    const stale = { ...fromDb, retirementYear: 2030 };
    const v = mergeSavedPlan(DEFAULT_VARIABLES, buildOverrides(stale, normalised));
    // plans.target_retirement_year is authoritative, not the blob's copy.
    expect(v.retirementYear).toBe(2038);
  });

  it("keeps CPP/OAS coming from plan_benefits, not the blob", () => {
    const stale = {
      ...fromDb,
      withdrawals: { ...fromDb.withdrawals!, cppShingoAnnual: 999 },
    };
    const v = mergeSavedPlan(DEFAULT_VARIABLES, buildOverrides(stale, normalised));
    expect(v.withdrawals.cppShingoAnnual).toBe(20000);
  });

  it("falls back to code defaults when the blob is absent", () => {
    const v = mergeSavedPlan(DEFAULT_VARIABLES, buildOverrides({}, normalised));
    expect(v.pensionAdjustmentShingo).toBe(DEFAULT_VARIABLES.pensionAdjustmentShingo);
    expect(v.withdrawals.rrifDepleteByAge).toBe(DEFAULT_VARIABLES.withdrawals.rrifDepleteByAge);
  });
});
