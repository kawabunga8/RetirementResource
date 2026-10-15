import { describe, expect, it } from "vitest";
import { updateTfsaLimitsFromDb } from "./publicRules";
import { tfsaLimitForYear } from "../tfsaRoom";

describe("loading TFSA limits from the database", () => {
  it("ignores an empty result instead of wiping the built-in table", () => {
    const before = tfsaLimitForYear(2026, 0.02);
    updateTfsaLimitsFromDb({});
    expect(before).toBeGreaterThan(0);
    expect(tfsaLimitForYear(2026, 0.02)).toBe(before);
    expect(tfsaLimitForYear(2030, 0.02)).toBeGreaterThan(0);
  });

  it("merges year by year, so a partial result keeps the other years", () => {
    updateTfsaLimitsFromDb({ "2026": 7000 });
    expect(tfsaLimitForYear(2026, 0.02)).toBe(7000);
    expect(tfsaLimitForYear(2023, 0.02)).toBeGreaterThan(0);
  });
});
