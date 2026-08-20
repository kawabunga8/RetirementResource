export type Bracket = { upTo: number; rate: number };

export type Jurisdiction = "federal" | "bc";

export type TaxYearTables = {
  year: number;
  federal: {
    brackets: Bracket[];
    lowestRate: number;
    bpa: number;
    ageAmountMax: number;
    ageAmountThreshold: number;
    ageAmountPhaseOutRate: number; // reduces credit amount $ per $ net income over threshold
    pensionCreditBase: number; // eligible pension income amount eligible for pension credit (e.g. 2000)
    oasClawbackThreshold: number;
    oasClawbackRate: number; // e.g. 0.15
  };
  bc: {
    brackets: Bracket[];
    lowestRate: number;
    bpa: number;
    ageAmountMax: number;
    ageAmountThreshold: number;
    ageAmountPhaseOutRate: number;
    pensionCreditBase: number;
  };
};

/**
 * Planning estimator tables.
 *
 * Notes:
 * - Values below are approximate and meant for sensitivity planning, not filing.
 * - Structure is intentionally year-based so we can plug in exact year tables later.
 */
export let TAX_TABLES: TaxYearTables[] = [
  {
    year: 2025,
    federal: {
      brackets: [
        // Thresholds: exact 2025 CRA values.
        // First-bracket rate: 14.5% (blended — 15% Jan–Jun, 14% Jul–Dec 2025).
        // See the year:2026 entry below for the permanent 14% rate onward.
        { upTo: 57375, rate: 0.145 },
        { upTo: 114750, rate: 0.205 },
        { upTo: 177882, rate: 0.26 },
        { upTo: 253414, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
      lowestRate: 0.145,
      bpa: 16129,
      ageAmountMax: 9028,
      ageAmountThreshold: 45522,
      ageAmountPhaseOutRate: 0.15,
      pensionCreditBase: 2000,
      oasClawbackThreshold: 93454,
      oasClawbackRate: 0.15,
    },
    bc: {
      brackets: [
        // Exact 2025 BC thresholds (indexed ~8% from 2024).
        { upTo: 49279, rate: 0.0506 },
        { upTo: 98560, rate: 0.077 },
        { upTo: 113158, rate: 0.105 },
        { upTo: 137407, rate: 0.1229 },
        { upTo: 186306, rate: 0.147 },
        { upTo: 259829, rate: 0.168 },
        { upTo: Infinity, rate: 0.205 },
      ],
      lowestRate: 0.0506,
      bpa: 12932,
      ageAmountMax: 5799,
      ageAmountThreshold: 43169,
      // 15%: $5,799 phases out to zero at $81,829 ($43,169 + $5,799/0.15).
      ageAmountPhaseOutRate: 0.15,
      pensionCreditBase: 1000,
    },
  },
  {
    year: 2026,
    federal: {
      brackets: [
        // Exact 2026 CRA thresholds. Lowest rate is 14% for the full year
        // (no more mid-year blend now that the 2025 Jul 1 cut is permanent).
        { upTo: 58523, rate: 0.14 },
        { upTo: 117045, rate: 0.205 },
        { upTo: 181440, rate: 0.26 },
        { upTo: 258482, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
      lowestRate: 0.14,
      bpa: 16452,
      ageAmountMax: 9208,
      ageAmountThreshold: 46432,
      ageAmountPhaseOutRate: 0.15,
      pensionCreditBase: 2000,
      oasClawbackThreshold: 95323,
      oasClawbackRate: 0.15,
    },
    bc: {
      brackets: [
        // Exact 2026 BC thresholds (indexed 2.2% from 2025). BC also raised
        // its lowest bracket rate from 5.06% to 5.60% starting 2026.
        { upTo: 50363, rate: 0.056 },
        { upTo: 100728, rate: 0.077 },
        { upTo: 115648, rate: 0.1050 },
        { upTo: 140430, rate: 0.1229 },
        { upTo: 190405, rate: 0.147 },
        { upTo: 265545, rate: 0.168 },
        { upTo: Infinity, rate: 0.205 },
      ],
      lowestRate: 0.056,
      bpa: 13216,
      ageAmountMax: 5927,
      ageAmountThreshold: 44119,
      // 15%: $5,927 phases out to zero at $83,632 ($44,119 + $5,927/0.15).
      ageAmountPhaseOutRate: 0.15,
      pensionCreditBase: 1000,
    },
  },
];

/**
 * A DB year-table is only usable if it actually carries the numbers we need.
 * `loadPublicRules` defaults missing credit rows to 0, so a year with bracket
 * rows but no matching credit row arrives with bpa: 0 -- which would silently
 * hand every projection a zero basic personal amount.
 */
function isUsableDbTable(t: TaxYearTables) {
  return (
    Number.isFinite(t.year) &&
    t.federal?.brackets?.length > 0 &&
    t.bc?.brackets?.length > 0 &&
    t.federal.bpa > 0 &&
    t.bc.bpa > 0
  );
}

/**
 * Merge DB-sourced tax tables over the built-in ones, BY YEAR.
 *
 * This used to be `TAX_TABLES = tables`, a wholesale replacement. Because
 * `pickTaxTables` selects the newest table at or below the requested year, a
 * database holding only 2025 silently deleted the built-in 2026 table and sent
 * every projection back to 2025 rates -- the 15% federal bottom rate instead of
 * the permanent 14%, and BC at 5.06% instead of 5.60%. Tests never caught it
 * because they exercise the built-in tables with no DB in play.
 *
 * Merging keeps the newer built-in years available while still letting the
 * database correct any year it actually has good data for. This also matches
 * how updateRrifFactorsFromDb and updateBcLifMaxFromDb already behave.
 */
export function updateTaxTablesFromDb(tables: TaxYearTables[]) {
  const byYear = new Map<number, TaxYearTables>();
  for (const t of TAX_TABLES) byYear.set(t.year, t);
  for (const t of tables ?? []) {
    if (isUsableDbTable(t)) byYear.set(t.year, t);
  }
  TAX_TABLES = [...byYear.values()].sort((a, b) => a.year - b.year);
}

export function pickTaxTables(taxYear: number): TaxYearTables {
  // Use the latest table <= taxYear; otherwise fall back to earliest.
  const sorted = [...TAX_TABLES].sort((a, b) => a.year - b.year);
  const eligible = sorted.filter((t) => t.year <= taxYear);
  return (eligible.length ? eligible[eligible.length - 1] : sorted[0])!;
}

function indexThreshold(threshold: number, fromYear: number, toYear: number, annualInflation: number) {
  if (!Number.isFinite(threshold) || threshold === Infinity) return threshold;
  const years = Math.max(0, toYear - fromYear);
  const growth = Math.pow(1 + Math.max(0, annualInflation), years);
  return threshold * growth;
}

/**
 * Default indexation rate used when a caller does not supply one.
 * CRA indexes brackets and most credit amounts to CPI every year; assuming 0%
 * silently bakes decades of bracket creep into any long-range projection.
 */
export const DEFAULT_TAX_INDEXATION = 0.02;

/**
 * Return a COMPLETE tax table for any year, with every CRA/BC-indexed dollar
 * amount inflated forward from the nearest base-year table.
 *
 * Indexed annually in real life (so indexed here):
 *   - bracket thresholds
 *   - basic personal amount
 *   - age amount (both the maximum and the phase-out threshold)
 *   - OAS recovery-tax (clawback) threshold
 *
 * NOT indexed in real life (so left alone here):
 *   - the pension income amount, fixed at $2,000 federally since 2001 and
 *     $1,000 in BC. Indexing it would overstate the credit in later years.
 *
 * Tax RATES are held constant — we have no basis for predicting rate changes.
 */
export function getIndexedTaxTables(taxYear: number, annualInflation: number): TaxYearTables {
  const base = pickTaxTables(taxYear);
  const idx = (v: number) => indexThreshold(v, base.year, taxYear, annualInflation);
  const idxBrackets = (brackets: Bracket[]) =>
    brackets.map((b) => ({ upTo: idx(b.upTo), rate: b.rate }));

  return {
    year: taxYear,
    federal: {
      ...base.federal,
      brackets: idxBrackets(base.federal.brackets),
      bpa: idx(base.federal.bpa),
      ageAmountMax: idx(base.federal.ageAmountMax),
      ageAmountThreshold: idx(base.federal.ageAmountThreshold),
      oasClawbackThreshold: idx(base.federal.oasClawbackThreshold),
      // pensionCreditBase intentionally NOT indexed
    },
    bc: {
      ...base.bc,
      brackets: idxBrackets(base.bc.brackets),
      bpa: idx(base.bc.bpa),
      ageAmountMax: idx(base.bc.ageAmountMax),
      ageAmountThreshold: idx(base.bc.ageAmountThreshold),
      // pensionCreditBase intentionally NOT indexed
    },
  };
}

/**
 * Return brackets for any year.
 *
 * If we don't have exact tables for taxYear, we inflate the nearest base-year thresholds using annualInflation.
 * Rates are assumed constant (planning approximation).
 */
export function getBracketTableForYear(params: {
  taxYear: number;
  annualInflation: number;
}) {
  const base = pickTaxTables(params.taxYear);

  const inflate = (brackets: Bracket[]) =>
    brackets.map((b) => ({
      upTo: indexThreshold(b.upTo, base.year, params.taxYear, params.annualInflation),
      rate: b.rate,
    }));

  return {
    baseYear: base.year,
    taxYear: params.taxYear,
    federal: {
      brackets: inflate(base.federal.brackets),
    },
    bc: {
      brackets: inflate(base.bc.brackets),
    },
  };
}
