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

export function updateTaxTablesFromDb(tables: TaxYearTables[]) {
  TAX_TABLES = tables;
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
