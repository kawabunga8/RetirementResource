import { describe, it, expect } from "vitest";
import { buildWithdrawalSchedule, rrifMinFactor } from "./engine";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, type Variables } from "../planDefaults";

const BALANCES = {
  fhsa: 0,
  rrsp: 400_000,
  tfsa: 100_000,
  lira: 300_000,
  nonRegistered: 100_000,
};

function run(overrides: Partial<Variables> = {}) {
  const vars: Variables = { ...DEFAULT_VARIABLES, ...overrides };
  return buildWithdrawalSchedule({
    vars,
    anchors: DEFAULT_ANCHORS,
    retirementYear: vars.retirementYear,
    retirementBalances: { ...BALANCES },
  });
}

describe("LIF minimum withdrawals", () => {
  it("are taken from age 72 even when forceLifFromRetirement is off", () => {
    const rows = run({
      withdrawals: { ...DEFAULT_VARIABLES.withdrawals, forceLifFromRetirement: false },
    });

    const at72 = rows.find((r) => r.ageShingo === 72);
    expect(at72).toBeDefined();
    expect(at72!.debug.lifMinRequired).toBeGreaterThan(0);
    expect(at72!.withdrawals.lira).toBeGreaterThan(0);
  });

  it("do not strand the LIRA for the rest of the plan", () => {
    const rows = run({
      withdrawals: { ...DEFAULT_VARIABLES.withdrawals, forceLifFromRetirement: false },
    });
    const last = rows[rows.length - 1]!;
    // Before the fix the LIRA simply compounded, untouched, forever.
    expect(last.endBalances.lira).toBeLessThan(BALANCES.lira);
  });
});

describe("RRIF minimum start year", () => {
  it("requires nothing at 71 and something at 72", () => {
    const rows = run({
      withdrawals: { ...DEFAULT_VARIABLES.withdrawals, rrifDepleteByAge: 95 },
    });
    const at71 = rows.find((r) => r.ageShingo === 71);
    const at72 = rows.find((r) => r.ageShingo === 72);

    expect(at71!.debug.rrifMinRequired).toBe(0);
    expect(at72!.debug.rrifMinRequired).toBeGreaterThan(0);
  });

  it("uses the CRA formula below 71 and the statutory table above", () => {
    expect(rrifMinFactor(65)).toBeCloseTo(1 / 25, 10);
    expect(rrifMinFactor(71)).toBeCloseTo(0.0528, 10);
    expect(rrifMinFactor(95)).toBeCloseTo(0.2, 10);
    expect(rrifMinFactor(99)).toBeCloseTo(0.2, 10);
  });
});

describe("LIF maximum is never exceeded", () => {
  it("holds even when the OAS ceiling leaves zero headroom", () => {
    // A binding ceiling used to collapse the LIRA cap to 0, which the old
    // withdrawFrom read as "no cap" and drained the whole account.
    const rows = run({
      spending: { goGo: 300_000, slowGo: 300_000, noGo: 300_000 },
      withdrawals: { ...DEFAULT_VARIABLES.withdrawals, avoidOasClawback: true },
    });

    for (const r of rows) {
      expect(r.withdrawals.lira).toBeLessThanOrEqual(r.debug.lifMaxAllowed + 1);
    }
  });
});

describe("CPP/OAS start age", () => {
  it("reduces benefit income when taken earlier", () => {
    const at70 = run({ cppStartAge: 70, oasStartAge: 70 });
    const at65 = run({ cppStartAge: 65, oasStartAge: 65 });

    // Compare a year in which both spouses are receiving under both scenarios.
    const y = at70.find((r) => r.ageShingo === 80)!.year;
    const a = at70.find((r) => r.year === y)!.benefitsIncome;
    const b = at65.find((r) => r.year === y)!.benefitsIncome;

    expect(b).toBeLessThan(a);
    expect(b).toBeGreaterThan(0);
  });

  it("pays nothing before the start age and something after", () => {
    const rows = run({ cppStartAge: 70, oasStartAge: 70 });
    const early = rows.find((r) => r.ageShingo === 68)!;
    const late = rows.find((r) => r.ageShingo === 75)!;
    expect(early.benefitsIncome).toBe(0);
    expect(late.benefitsIncome).toBeGreaterThan(0);
  });
});
