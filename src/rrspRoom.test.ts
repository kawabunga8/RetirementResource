import { describe, it, expect } from "vitest";
import { newRrspRoomForYear, RRSP_ROOM_RATE } from "./rrspRoom";

describe("new RRSP room matches a real Notice of Assessment", () => {
  /**
   * Shingo's 2023 NOA, "Your additional RRSP deduction limit earned in 2023":
   *
   *   18% of 2023 earned income, up to a maximum of $31,560 ....... 15,804
   *   Minus: 2023 pension adjustment (PA) ......................... 14,428
   *   Equals: Additional RRSP deduction limit earned in 2023 ....... 1,376
   *
   * $15,804 / 0.18 => $87,800 of earned income.
   */
  const EARNED_2023 = 15804 / RRSP_ROOM_RATE;

  it("reproduces the CRA figure to the dollar", () => {
    const room = newRrspRoomForYear({
      year: 2023,
      earnedIncome: EARNED_2023,
      pensionAdjustment: 14428,
      rrspDollarLimit: 31560,
      rrspDollarLimitYear: 2023,
      annualInflation: 0,
    });
    expect(Math.round(room)).toBe(1376);
  });

  it("applies the annual dollar limit when 18% of income exceeds it", () => {
    const room = newRrspRoomForYear({
      year: 2023,
      earnedIncome: 400_000, // 18% = $72,000, far above the 2023 cap
      pensionAdjustment: 0,
      rrspDollarLimit: 31560,
      rrspDollarLimitYear: 2023,
      annualInflation: 0,
    });
    expect(Math.round(room)).toBe(31560);
  });

  it("indexes the dollar limit forward from its stated year", () => {
    const room = newRrspRoomForYear({
      year: 2028, earnedIncome: 400_000, pensionAdjustment: 0,
      rrspDollarLimit: 33810, rrspDollarLimitYear: 2026, annualInflation: 0.03,
    });
    expect(Math.round(room)).toBe(Math.round(33810 * 1.03 ** 2));
  });

  it("never returns negative room, as the NOA says", () => {
    // "Equals: Additional RRSP deduction limit you earned in 2023
    //  (if negative, will be '0')"
    const room = newRrspRoomForYear({
      year: 2023, earnedIncome: 50_000, pensionAdjustment: 40_000,
      rrspDollarLimit: 31560, rrspDollarLimitYear: 2023, annualInflation: 0,
    });
    expect(room).toBe(0);
  });
});
