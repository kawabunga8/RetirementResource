/**
 * Diagnostic snapshot: runs the withdrawal engine with DEFAULT_ANCHORS / DEFAULT_VARIABLES
 * and prints a compact summary. Used to compare model behaviour before/after changes.
 *
 * Run: npx tsx scripts/snapshot.mts
 */
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES } from "../src/planDefaults";
import { buildWithdrawalSchedule } from "../src/withdrawals/engine";

const vars = DEFAULT_VARIABLES;
const anchors = DEFAULT_ANCHORS;

// Rough retirement balances so the comparison is stable and independent of App.tsx.
const retirementBalances = {
  fhsa: 0,
  rrsp: 900_000,
  tfsa: 250_000,
  lira: 300_000,
  nonRegistered: 150_000,
};

const rows = buildWithdrawalSchedule({
  vars,
  anchors,
  retirementYear: vars.retirementYear,
  retirementBalances,
});

const real = (nominal: number, year: number) =>
  nominal / Math.pow(1 + vars.expectedInflation, year - anchors.baselineYear);

let totalTaxReal = 0;
let totalClawbackReal = 0;
let shortfallYears = 0;

console.log("year  age  taxable$   tax$    effRate  clawback$  shortfall$  endTotal$ (all REAL 2026$)");
for (const r of rows) {
  const taxable = r.debug.taxableIncomeShingo + r.debug.taxableIncomeSarah;
  totalTaxReal += real(r.debug.tax, r.year);
  totalClawbackReal += real(r.debug.oasClawbackShingo + r.debug.oasClawbackSarah, r.year);
  if (r.debug.shortfallAfterTax > 1) shortfallYears++;

  const endTotal =
    r.endBalances.fhsa + r.endBalances.rrsp + r.endBalances.tfsa +
    r.endBalances.lira + r.endBalances.nonRegistered;

  if (r.year % 4 === 0 || r === rows[rows.length - 1]) {
    console.log(
      String(r.year).padEnd(6) +
      String(r.ageShingo).padEnd(5) +
      Math.round(real(taxable, r.year)).toLocaleString().padStart(9) +
      Math.round(real(r.debug.tax, r.year)).toLocaleString().padStart(9) +
      ((taxable > 0 ? (r.debug.tax / taxable) * 100 : 0).toFixed(1) + "%").padStart(9) +
      Math.round(real(r.debug.oasClawbackShingo + r.debug.oasClawbackSarah, r.year)).toLocaleString().padStart(11) +
      Math.round(real(r.debug.shortfallAfterTax, r.year)).toLocaleString().padStart(12) +
      Math.round(real(endTotal, r.year)).toLocaleString().padStart(12)
    );
  }
}

const last = rows[rows.length - 1]!;
const finalTotal =
  last.endBalances.fhsa + last.endBalances.rrsp + last.endBalances.tfsa +
  last.endBalances.lira + last.endBalances.nonRegistered;

console.log("\n--- TOTALS (real 2026 dollars) ---");
console.log("years simulated:        ", rows.length);
console.log("lifetime tax:            $" + Math.round(totalTaxReal).toLocaleString());
console.log("lifetime OAS clawback:   $" + Math.round(totalClawbackReal).toLocaleString());
console.log("years with a shortfall:  ", shortfallYears);
console.log("final estate (real):     $" + Math.round(real(finalTotal, last.year)).toLocaleString());
console.log("final LIRA (real):       $" + Math.round(real(last.endBalances.lira, last.year)).toLocaleString());

// --- CPP start-age sensitivity -------------------------------------------
console.log("\n--- CPP/OAS START AGE SENSITIVITY (real 2026$) ---");
console.log("start  lifetime tax   lifetime clawback   final estate");
for (const startAge of [60, 65, 67, 70]) {
  const rs = buildWithdrawalSchedule({
    vars: { ...vars, cppStartAge: startAge, oasStartAge: startAge },
    anchors,
    retirementYear: vars.retirementYear,
    retirementBalances: { ...retirementBalances },
  });
  let t = 0, c = 0;
  for (const r of rs) {
    t += real(r.debug.tax, r.year);
    c += real(r.debug.oasClawbackShingo + r.debug.oasClawbackSarah, r.year);
  }
  const l = rs[rs.length - 1]!;
  const est = l.endBalances.fhsa + l.endBalances.rrsp + l.endBalances.tfsa +
              l.endBalances.lira + l.endBalances.nonRegistered;
  console.log(
    String(startAge).padEnd(7) +
    ("$" + Math.round(t).toLocaleString()).padStart(13) +
    ("$" + Math.round(c).toLocaleString()).padStart(20) +
    ("$" + Math.round(real(est, l.year)).toLocaleString()).padStart(15)
  );
}
