import { describe, it, expect, beforeEach } from "vitest";
import { TAX_TABLES, updateTaxTablesFromDb, pickTaxTables, type TaxYearTables } from "./tables";

/** Snapshot the built-in tables so each test starts from a known state. */
const BUILTIN: TaxYearTables[] = JSON.parse(JSON.stringify(TAX_TABLES));
const reset = () => updateTaxTablesFromDb(BUILTIN);

/** A 2025-only payload shaped like what loadPublicRules produces. */
const db2025: TaxYearTables = JSON.parse(JSON.stringify(BUILTIN.find((t) => t.year === 2025)));

beforeEach(reset);

describe("updateTaxTablesFromDb", () => {
  it("keeps the built-in 2026 table when the database only has 2025", () => {
    // The live bug: a 2025-only database wiped 2026, so every projection year
    // fell back to 2025 rates -- 15% federal instead of 14%, BC 5.06% not 5.60%.
    updateTaxTablesFromDb([db2025]);

    const picked = pickTaxTables(2036);
    expect(picked.year).toBe(2026);
    expect(picked.federal.brackets[0]!.rate).toBeCloseTo(0.14, 10);
    expect(picked.bc.brackets[0]!.rate).toBeCloseTo(0.056, 10);
  });

  it("still lets the database correct a year it does have", () => {
    const edited: TaxYearTables = JSON.parse(JSON.stringify(db2025));
    edited.federal.bpa = 99_999;
    updateTaxTablesFromDb([edited]);

    expect(pickTaxTables(2025).federal.bpa).toBe(99_999);
    // ...without disturbing other years
    expect(pickTaxTables(2026).federal.bpa).toBe(
      BUILTIN.find((t) => t.year === 2026)!.federal.bpa
    );
  });

  it("adds genuinely newer years from the database", () => {
    const y2027: TaxYearTables = JSON.parse(JSON.stringify(BUILTIN.find((t) => t.year === 2026)));
    y2027.year = 2027;
    y2027.federal.bpa = 17_000;
    updateTaxTablesFromDb([y2027]);

    expect(pickTaxTables(2030).year).toBe(2027);
    expect(pickTaxTables(2030).federal.bpa).toBe(17_000);
  });

  it("ignores malformed rows rather than zeroing out a year", () => {
    // loadPublicRules defaults a missing credits row to bpa: 0.
    const broken: TaxYearTables = JSON.parse(JSON.stringify(BUILTIN.find((t) => t.year === 2026)));
    broken.federal.bpa = 0;
    broken.bc.bpa = 0;
    updateTaxTablesFromDb([broken]);

    expect(pickTaxTables(2026).federal.bpa).toBeGreaterThan(0);
  });

  it("ignores a year that arrives with no brackets", () => {
    const empty: TaxYearTables = JSON.parse(JSON.stringify(BUILTIN.find((t) => t.year === 2026)));
    empty.federal.brackets = [];
    updateTaxTablesFromDb([empty]);

    expect(pickTaxTables(2026).federal.brackets.length).toBeGreaterThan(0);
  });

  it("keeps the table list sorted by year", () => {
    const y2027: TaxYearTables = JSON.parse(JSON.stringify(BUILTIN.find((t) => t.year === 2026)));
    y2027.year = 2027;
    updateTaxTablesFromDb([y2027, db2025]);

    const years = TAX_TABLES.map((t) => t.year);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});
