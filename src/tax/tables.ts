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
export const TAX_TABLES: TaxYearTables[] = [
  {
    year: 2025,
    federal: {
      brackets: [
        { upTo: 55867, rate: 0.15 },
        { upTo: 111733, rate: 0.205 },
        { upTo: 173205, rate: 0.26 },
        { upTo: 246752, rate: 0.29 },
        { upTo: Infinity, rate: 0.33 },
      ],
      lowestRate: 0.15,
      // Approx BPA / age amount. Replace with exact values as needed.
      bpa: 15705,
      ageAmountMax: 9028,
      ageAmountThreshold: 45000,
      ageAmountPhaseOutRate: 0.15,
      pensionCreditBase: 2000,
      // Approx OAS recovery threshold and rate.
      oasClawbackThreshold: 91000,
      oasClawbackRate: 0.15,
    },
    bc: {
      brackets: [
        { upTo: 45654, rate: 0.0506 },
        { upTo: 91310, rate: 0.077 },
        { upTo: 104835, rate: 0.105 },
        { upTo: 127299, rate: 0.1229 },
        { upTo: 172602, rate: 0.147 },
        { upTo: 240716, rate: 0.168 },
        { upTo: Infinity, rate: 0.205 },
      ],
      lowestRate: 0.0506,
      bpa: 12580,
      ageAmountMax: 5450,
      ageAmountThreshold: 42500,
      ageAmountPhaseOutRate: 0.034,
      pensionCreditBase: 2000,
    },
  },
];

export function pickTaxTables(taxYear: number): TaxYearTables {
  // Use the latest table <= taxYear; otherwise fall back to earliest.
  const sorted = [...TAX_TABLES].sort((a, b) => a.year - b.year);
  const eligible = sorted.filter((t) => t.year <= taxYear);
  return (eligible.length ? eligible[eligible.length - 1] : sorted[0])!;
}
