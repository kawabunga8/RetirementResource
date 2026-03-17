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
        // From 2026 onward the rate is permanently 14%; add a year:2026 entry when exact thresholds are confirmed.
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
