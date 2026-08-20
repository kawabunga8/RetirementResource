import { describe, it, expect } from "vitest";
import { checkRulesFreshness, formatFreshnessReport } from "./freshness";

const thisYear = new Date().getFullYear();

describe("public-rule data is current", () => {
  /**
   * The check that matters. It fails on 1 January of any year whose tax tables
   * have not been added yet -- which is exactly when someone should be warned,
   * and roughly a decade earlier than anyone would have noticed by hand.
   *
   * A failure here does NOT block deploys: `npm run build` is `tsc -b && vite
   * build` and does not run tests. It fails loudly without breaking the site.
   */
  it(`has tax tables and TFSA limits covering ${thisYear}`, () => {
    const problems = checkRulesFreshness(thisYear);
    expect(formatFreshnessReport(problems)).toBe("All public-rule data is current.");
    expect(problems).toEqual([]);
  });
});

describe("the staleness check actually detects staleness", () => {
  // Without these, the test above could pass forever by simply never failing.

  it("flags both datasets once the calendar runs past them", () => {
    const problems = checkRulesFreshness(thisYear + 5);
    expect(problems.map((p) => p.what).sort()).toEqual(["TFSA limits", "tax tables"]);
  });

  it("explains what is wrong and what to do about it", () => {
    const [first] = checkRulesFreshness(thisYear + 5);
    expect(first!.detail).toContain(String(thisYear + 5));
    expect(first!.fix.length).toBeGreaterThan(20);
  });

  it("is quiet about years already covered", () => {
    expect(checkRulesFreshness(thisYear - 1)).toEqual([]);
    expect(checkRulesFreshness(2020)).toEqual([]);
  });

  it("produces a readable report for the CI job to paste into an issue", () => {
    const report = formatFreshnessReport(checkRulesFreshness(thisYear + 5));
    expect(report).toContain("tax tables");
    expect(report).toContain("Fix:");
    expect(report).not.toBe("All public-rule data is current.");
  });
});
