/**
 * TFSA annual dollar limit for any year, including years CRA has not yet
 * announced.
 *
 * The published table (src/data/publicRules.ts) only runs to the current year.
 * Every lookup past it used to fall back to $0, so the plan created no new TFSA
 * room at all from 2027 on -- in the working years and in retirement alike.
 *
 * CRA indexes the limit to inflation and rounds to the nearest $500, so future
 * years carry the last published limit forward at the plan's inflation
 * assumption and round the same way.
 */
import { TFSA_ANNUAL_LIMIT_BY_YEAR } from "./data/publicRules";

export const TFSA_LIMIT_ROUNDING = 500;

export function tfsaLimitForYear(year: number, annualInflation: number): number {
  const table = TFSA_ANNUAL_LIMIT_BY_YEAR;
  const published = table[String(year)];
  if (published != null) return published;

  const years = Object.keys(table)
    .map(Number)
    .filter((y) => Number.isFinite(y))
    .sort((a, b) => a - b);
  if (years.length === 0) return 0;

  const lastYear = years[years.length - 1]!;
  // Before the table starts there was no TFSA.
  if (year < lastYear) return 0;

  const lastLimit = table[String(lastYear)] ?? 0;
  const indexed = lastLimit * Math.pow(1 + Math.max(0, annualInflation), year - lastYear);
  return Math.round(indexed / TFSA_LIMIT_ROUNDING) * TFSA_LIMIT_ROUNDING;
}
