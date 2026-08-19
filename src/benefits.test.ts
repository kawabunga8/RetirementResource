import { describe, it, expect } from "vitest";
import {
  cppAdjustmentFactor,
  oasAdjustmentFactor,
  cppAmountForStartAge,
  oasAmountForStartAge,
  effectiveCppStartAge,
  effectiveOasStartAge,
} from "./benefits";

describe("CPP start-age adjustment", () => {
  it("is unchanged at 65", () => {
    expect(cppAdjustmentFactor(65)).toBeCloseTo(1, 10);
  });

  it("is -36% at 60 and +42% at 70", () => {
    expect(cppAdjustmentFactor(60)).toBeCloseTo(0.64, 10);
    expect(cppAdjustmentFactor(70)).toBeCloseTo(1.42, 10);
  });

  it("clamps outside the 60-70 window", () => {
    expect(cppAdjustmentFactor(55)).toBeCloseTo(cppAdjustmentFactor(60), 10);
    expect(cppAdjustmentFactor(75)).toBeCloseTo(cppAdjustmentFactor(70), 10);
    expect(effectiveCppStartAge(55)).toBe(60);
    expect(effectiveCppStartAge(75)).toBe(70);
  });
});

describe("OAS start-age adjustment", () => {
  it("is unchanged at 65 and +36% at 70", () => {
    expect(oasAdjustmentFactor(65)).toBeCloseTo(1, 10);
    expect(oasAdjustmentFactor(70)).toBeCloseTo(1.36, 10);
  });

  it("cannot start before 65", () => {
    expect(oasAdjustmentFactor(60)).toBeCloseTo(1, 10);
    expect(effectiveOasStartAge(60)).toBe(65);
  });
});

describe("converting an amount quoted at 70", () => {
  it("returns the quoted amount when starting at 70", () => {
    expect(cppAmountForStartAge(20_400, 70)).toBeCloseTo(20_400, 6);
    expect(oasAmountForStartAge(11_000, 70)).toBeCloseTo(11_000, 6);
  });

  it("scales a $20,400-at-70 CPP down to the age-65 and age-60 amounts", () => {
    // 20400 / 1.42 = 14366.20 at 65; x0.64 = 9194.37 at 60
    expect(cppAmountForStartAge(20_400, 65)).toBeCloseTo(20_400 / 1.42, 4);
    expect(cppAmountForStartAge(20_400, 60)).toBeCloseTo((20_400 / 1.42) * 0.64, 4);
  });

  it("scales an $11,000-at-70 OAS down to the age-65 amount", () => {
    expect(oasAmountForStartAge(11_000, 65)).toBeCloseTo(11_000 / 1.36, 4);
  });

  it("makes starting earlier strictly smaller", () => {
    const at70 = cppAmountForStartAge(20_400, 70);
    const at67 = cppAmountForStartAge(20_400, 67);
    const at62 = cppAmountForStartAge(20_400, 62);
    expect(at67).toBeLessThan(at70);
    expect(at62).toBeLessThan(at67);
  });
});
