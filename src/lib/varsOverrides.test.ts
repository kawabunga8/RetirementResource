import { describe, it, expect } from "vitest";
import { DEFAULT_VARIABLES, type Variables } from "../planDefaults";
import type { PlanVarsOverrides } from "./db";

/**
 * Mirrors the merge App.tsx performs when a saved plan loads.
 * The database supplies only CPP/OAS amounts; everything else in `withdrawals`
 * must survive from the defaults.
 */
function mergeSavedPlan(base: Variables, ov: PlanVarsOverrides): Variables {
  return { ...base, ...ov, withdrawals: { ...base.withdrawals, ...ov.withdrawals } };
}

describe("loading a saved plan", () => {
  const ov: PlanVarsOverrides = {
    retirementYear: 2040,
    withdrawals: {
      cppShingoAnnual: 20000, cppSarahAnnual: 18000,
      oasShingoAnnual: 10000, oasSarahAnnual: 10000,
    },
  };

  it("applies the values the database actually stores", () => {
    const v = mergeSavedPlan(DEFAULT_VARIABLES, ov);
    expect(v.retirementYear).toBe(2040);
    expect(v.withdrawals.cppShingoAnnual).toBe(20000);
  });

  it("keeps every withdrawal setting the database does not store", () => {
    const v = mergeSavedPlan(DEFAULT_VARIABLES, ov);
    // These are absent from varsOverrides. Before the type was a deep partial,
    // a four-field object was cast as the whole thing, so a plain `...ov`
    // spread would have blanked all of these with no type error.
    expect(v.withdrawals.rrifDepleteByAge).toBe(DEFAULT_VARIABLES.withdrawals.rrifDepleteByAge);
    expect(v.withdrawals.lifMode).toBe(DEFAULT_VARIABLES.withdrawals.lifMode);
    expect(v.withdrawals.order).toEqual(DEFAULT_VARIABLES.withdrawals.order);
    expect(v.withdrawals.avoidOasClawback).toBe(DEFAULT_VARIABLES.withdrawals.avoidOasClawback);
    expect(v.withdrawals.caps).toEqual(DEFAULT_VARIABLES.withdrawals.caps);
    expect(v.withdrawals.forceLifFromRetirement).toBe(DEFAULT_VARIABLES.withdrawals.forceLifFromRetirement);
  });

  it("leaves code-only settings at their defaults", () => {
    // The database has no column for these, so they must come from the code.
    const v = mergeSavedPlan(DEFAULT_VARIABLES, ov);
    expect(v.pensionIndexRateShingo).toBe(0);
    expect(v.pensionAdjustmentShingo).toBe(16275);
    expect(v.earnedIncomeShingo).toBe(98591);
  });
});
