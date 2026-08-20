import { TAX_TABLES } from "./tables";
import { TFSA_ANNUAL_LIMIT_BY_YEAR } from "../data/publicRules";

/**
 * Calendar staleness checks for the hand-maintained public-rule data.
 *
 * These deliberately do NOT fetch anything. They only ask "has the calendar
 * moved past the newest figures we hold?", which needs no network, no HTML
 * parsing, and can never be flaky or misread a government page.
 *
 * That is enough to catch the failure this exists for: tax data quietly
 * falling a year (or two) behind while every projection keeps running as if
 * nothing were wrong.
 */

export type FreshnessProblem = {
  /** Short label for the thing that is stale. */
  what: string;
  /** What is actually wrong, with the numbers. */
  detail: string;
  /** What a human should do about it. */
  fix: string;
};

export function checkRulesFreshness(currentYear: number): FreshnessProblem[] {
  const problems: FreshnessProblem[] = [];

  // ── Tax brackets and credits ──────────────────────────────────────────────
  const taxYears = TAX_TABLES.map((t) => t.year).sort((a, b) => a - b);
  const newestTaxYear = taxYears[taxYears.length - 1];

  if (newestTaxYear === undefined) {
    problems.push({
      what: "tax tables",
      detail: "TAX_TABLES is empty.",
      fix: "Restore the bracket and credit tables in src/tax/tables.ts.",
    });
  } else if (newestTaxYear < currentYear) {
    problems.push({
      what: "tax tables",
      detail:
        `Newest tax table is ${newestTaxYear}, but it is now ${currentYear}. ` +
        `Every projection is being taxed with ${newestTaxYear} brackets, credits ` +
        `and OAS clawback threshold, indexed forward by assumption rather than ` +
        `by published figures.`,
      fix:
        `Add a ${currentYear} entry to TAX_TABLES in src/tax/tables.ts: federal and ` +
        `BC brackets, basic personal amount, age amount and its threshold, and the ` +
        `federal OAS recovery-tax threshold. Leave the pension amount at $2,000 ` +
        `federal / $1,000 BC — it is fixed in law and not indexed. ` +
        `Sources: canada.ca (CRA indexation) and www2.gov.bc.ca (BC personal tax rates).`,
    });
  }

  // ── TFSA annual limits ────────────────────────────────────────────────────
  const tfsaYears = Object.keys(TFSA_ANNUAL_LIMIT_BY_YEAR)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const newestTfsaYear = tfsaYears[tfsaYears.length - 1];

  if (newestTfsaYear === undefined) {
    problems.push({
      what: "TFSA limits",
      detail: "TFSA_ANNUAL_LIMIT_BY_YEAR is empty.",
      fix: "Run `npm run update:public-rules` to regenerate src/data/publicRules.ts.",
    });
  } else if (newestTfsaYear < currentYear) {
    problems.push({
      what: "TFSA limits",
      detail:
        `Newest TFSA annual limit is for ${newestTfsaYear}, but it is now ${currentYear}. ` +
        `Contribution room stops accruing in the projection after ${newestTfsaYear}.`,
      fix:
        "Run `npm run update:public-rules` (it scrapes the CRA contribution-room page). " +
        "If that fails, add the year by hand to src/data/publicRules.ts.",
    });
  }

  return problems;
}

/** Human-readable report, used by the test output and the scheduled CI job. */
export function formatFreshnessReport(problems: FreshnessProblem[]) {
  if (problems.length === 0) return "All public-rule data is current.";
  return problems
    .map((p) => `• ${p.what}\n  ${p.detail}\n  Fix: ${p.fix}`)
    .join("\n\n");
}
