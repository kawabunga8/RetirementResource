import type { LifMode } from "../planDefaults";
import { RETIREMENT_YEAR_FRACTION } from "../planDefaults";
import type { WithdrawalScheduleRow } from "./engine";

/**
 * Withdrawal strategies.
 *
 * `engine.ts` already separates "run the plan" (simulate) from "choose the
 * plan" (the levelling solver). These are alternative choosers. Each returns an
 * ExtraPlan — year to extra RRSP/RRIF withdrawal, nominal — and the engine runs
 * it unchanged, so the RRIF minimums, the BC LIF limits, the OAS guardrail and
 * the tax model all stay exactly as they are.
 *
 * The three tax-aware modes are deliberately NOT bound by rrifDepleteByAge.
 * That rule belongs to the "deplete by" strategy; the others pick their own
 * horizon, because forcing the same money out in fewer years is what creates
 * the clawback years they exist to avoid.
 */

export type SmoothingMode = "depleteBy" | "levelTax" | "levelRate" | "minLifetime";

export type ExtraPlan = Record<number, number>;

export type SimulateOverrides = {
  lifMode?: LifMode;
  /** Age at which the RRSP is forced to zero. Pass NEVER_DEPLETE to lift it. */
  depleteByAge?: number;
};

export type SimulateFn = (plan: ExtraPlan, overrides?: SimulateOverrides) => WithdrawalScheduleRow[];

export type StrategyContext = {
  simulate: SimulateFn;
  retirementYear: number;
  /** The plan's own deplete-by age — used by the "depleteBy" strategy only. */
  depleteAge: number;
  endAge: number;
  frontLoad: number;
  growth: number;
  rrspAtRetirement: number;
  /** Keep discretionary withdrawals out of the retirement year. */
  skipRetirementYear: boolean;
};

/** No forced depletion: the RRIF minimums are the only floor. */
export const NEVER_DEPLETE = 999;

/** Registered money left at the end is taxable on the second death. */
const TERMINAL_RATE = 0.45;

/** Above this, a strategy has not really drained the registered accounts. */
const DRAINED_TOLERANCE = 5000;

const WEIGHT_FLOOR = 0.04;

/** The retirement year is a half year of retirement income — excluded from level-ness. */
const fullYears = (rows: WithdrawalScheduleRow[], ctx: StrategyContext) =>
  rows.filter((r) => r.year !== ctx.retirementYear);

const taxByYear = (rows: WithdrawalScheduleRow[], ctx: StrategyContext) =>
  new Map(fullYears(rows, ctx).map((r) => [r.year, r.debug.tax] as const));

const rateByYear = (rows: WithdrawalScheduleRow[], ctx: StrategyContext) =>
  new Map(
    fullYears(rows, ctx).map((r) => {
      const taxable = r.debug.taxableIncomeShingo + r.debug.taxableIncomeSarah;
      return [r.year, taxable > 0 ? r.debug.tax / taxable : 0] as const;
    })
  );

/** Total household tax across the plan, the retirement year's salary included. */
export const lifetimeTax = (rows: WithdrawalScheduleRow[]) =>
  rows.reduce((a, r) => a + r.debug.tax + r.debug.taxOnEmployment, 0);

export function terminalTax(rows: WithdrawalScheduleRow[]) {
  const last = rows[rows.length - 1];
  if (!last) return 0;
  return (last.endBalances.rrsp + last.endBalances.lira + last.endBalances.fhsa) * TERMINAL_RATE;
}

const spreadOf = (m: Map<number, number>) => {
  const v = [...m.values()];
  return v.length ? Math.max(...v) - Math.min(...v) : 0;
};

function horizonInfo(rows: WithdrawalScheduleRow[], ctx: StrategyContext, horizonAge: number) {
  const dep = rows.find((r) => r.ageShingo >= horizonAge);
  const lastYear = dep ? dep.year : rows[rows.length - 1]!.year + 1;
  const years = rows
    .filter((r) => r.year >= ctx.retirementYear && r.year < lastYear)
    .map((r) => r.year);
  return { lastYear, years };
}

/** Normalise weights to average 1, honouring the retirement-year rule. */
function shapeWeights(
  years: number[],
  ctx: StrategyContext,
  shape: (index: number, count: number) => number
) {
  const raw = years.map((y, idx) => {
    if (ctx.skipRetirementYear && y === ctx.retirementYear) return 0;
    const base = shape(idx, years.length);
    return base * (y === ctx.retirementYear ? RETIREMENT_YEAR_FRACTION : 1);
  });
  const avg = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((w) => (avg > 0 ? w / avg : 1));
}

/**
 * Scale `weights` by a single amplitude until the RRSP lands at ~0 by the
 * horizon, using the previous simulation to estimate what spending will take
 * out anyway.
 */
function planFromWeights(
  rows: WithdrawalScheduleRow[],
  ctx: StrategyContext,
  years: number[],
  lastYear: number,
  weights: number[]
): ExtraPlan {
  const baseByYear = new Map<number, number>();
  for (const r of rows) {
    if (r.year >= ctx.retirementYear && r.year < lastYear) {
      baseByYear.set(r.year, Math.max(0, r.debug.rrspBeforeOverlay));
    }
  }

  const growth = Math.max(0, ctx.growth);
  const B0 = Math.max(0, ctx.rrspAtRetirement);

  const endBalanceFor = (amplitude: number) => {
    let bal = B0;
    for (let i = 0; i < years.length; i++) {
      const base = baseByYear.get(years[i]!) ?? 0;
      const taken = Math.min(bal, base + Math.max(0, amplitude * weights[i]!));
      const share = years[i] === ctx.retirementYear ? RETIREMENT_YEAR_FRACTION : 1;
      bal = (bal - taken) * Math.pow(1 + growth, share);
    }
    return bal;
  };

  let lo = 0;
  let hi = Math.max(1, B0);
  while (endBalanceFor(hi) > 1 && hi < B0 * 10) hi *= 1.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (endBalanceFor(mid) > 1) lo = mid;
    else hi = mid;
  }

  const plan: ExtraPlan = {};
  for (let i = 0; i < years.length; i++) plan[years[i]!] = Math.max(0, hi * weights[i]!);
  return plan;
}

function leftoverAt(rows: WithdrawalScheduleRow[], horizonAge: number) {
  const dep = rows.find((r) => r.ageShingo >= horizonAge);
  return dep ? Math.max(0, dep.debug.startBalances.rrsp) : 0;
}

/**
 * Amortise the RRSP over a horizon, iterating until nothing is left for the
 * depletion year to dump.
 *
 * One pass is not enough. The amplitude is estimated from a simulation run
 * WITHOUT the overlay; applying it changes the balance path and strands a
 * remainder, which the forced depletion then takes out in a single year at the
 * worst rate in the plan. Each round re-derives the baseline from the previous
 * full simulation.
 */
function amortise(
  ctx: StrategyContext,
  horizonAge: number,
  ratio: number,
  rounds = 4,
  tolerance = 250,
  overrides: SimulateOverrides = {}
): ExtraPlan {
  if (horizonAge >= NEVER_DEPLETE) return {};
  let rows = ctx.simulate({}, overrides);
  let bestPlan: ExtraPlan = {};
  let bestLeftover = Infinity;

  for (let round = 0; round < rounds; round++) {
    const { lastYear, years } = horizonInfo(rows, ctx, horizonAge);
    if (years.length === 0) break;
    const weights = shapeWeights(years, ctx, (idx, n) =>
      ratio === 1 ? 1 : Math.pow(ratio, n - 1 - idx)
    );
    const plan = planFromWeights(rows, ctx, years, lastYear, weights);
    rows = ctx.simulate(plan, overrides);
    const leftover = leftoverAt(rows, horizonAge);
    if (leftover < bestLeftover) {
      bestPlan = plan;
      bestLeftover = leftover;
    }
    if (bestLeftover <= tolerance) break;
  }
  return bestPlan;
}

/** Iteratively reweight until a per-year signal flattens. */
function levellingSolve(
  ctx: StrategyContext,
  signalFn: (rows: WithdrawalScheduleRow[], ctx: StrategyContext) => Map<number, number>,
  tolerance: number,
  horizonAge: number,
  overrides: SimulateOverrides = {}
): ExtraPlan {
  let rows = ctx.simulate({}, overrides);
  const { lastYear, years } = horizonInfo(rows, ctx, horizonAge);
  if (years.length === 0) return {};

  let weights = shapeWeights(years, ctx, () => 1);
  let plan = planFromWeights(rows, ctx, years, lastYear, weights);
  let best: { plan: ExtraPlan; score: number } = { plan, score: Infinity };
  let step = 0.5;

  for (let round = 0; round < 10; round++) {
    rows = ctx.simulate(plan, overrides);
    const signal = signalFn(rows, ctx);
    const vals = years.map((y) => signal.get(y) ?? 0);
    const active = vals.filter((_, i) => weights[i]! > 0);
    if (active.length === 0) break;

    const mean = active.reduce((a, b) => a + b, 0) / active.length;
    const score = Math.max(...active) - Math.min(...active);
    if (score < best.score) best = { plan: { ...plan }, score };
    if (score < tolerance) break;

    const next = weights.map((w, i) => {
      if (w === 0) return 0;
      const dev = mean !== 0 ? (vals[i]! - mean) / Math.abs(mean) : 0;
      return Math.max(WEIGHT_FLOOR, w * (1 - step * Math.max(-0.9, Math.min(0.9, dev))));
    });
    const avg = next.reduce((a, b) => a + b, 0) / next.length;
    weights = next.map((w) => (avg > 0 ? w / avg : 1));
    plan = planFromWeights(rows, ctx, years, lastYear, weights);
    step *= 0.85;
  }
  return best.plan;
}

/** Grid over overlay shapes for one horizon, scored on total tax incl. the terminal bill. */
function minLifetimeSolve(
  ctx: StrategyContext,
  horizonAge: number,
  overrides: SimulateOverrides = {}
): ExtraPlan {
  const seed = ctx.simulate({}, overrides);
  // Taking only the RRIF minimums and leaving the rest is a real candidate
  // once the deplete-by rule is lifted.
  let best = { plan: {} as ExtraPlan, score: lifetimeTax(seed) + terminalTax(seed) };
  if (horizonAge >= NEVER_DEPLETE) return best.plan;

  for (const ratio of [1, 1.6]) {
    const plan = amortise(ctx, horizonAge, ratio, 7, 250, overrides);
    const rows = ctx.simulate(plan, overrides);
    const score = lifetimeTax(rows) + terminalTax(rows);
    if (score < best.score) best = { plan, score };
  }
  return best.plan;
}

export type StrategyDefinition = {
  key: SmoothingMode;
  label: string;
  blurb: string;
  /** Candidate depletion horizons. Only "depleteBy" uses the plan's own age. */
  horizons: (ctx: StrategyContext) => number[];
  solve: (ctx: StrategyContext, horizonAge: number, overrides: SimulateOverrides) => ExtraPlan;
  /** Lower is better. */
  objective: (rows: WithdrawalScheduleRow[], ctx: StrategyContext) => number;
  /** Candidates failing this are only used when none pass. */
  feasible?: (rows: WithdrawalScheduleRow[]) => boolean;
};

export const STRATEGIES: StrategyDefinition[] = [
  {
    key: "depleteBy",
    label: "Deplete by 75",
    blurb:
      "What the plan does today: drain the RRSP by the deplete-by age, weighted by the front-load setting. The baseline the others are measured against.",
    horizons: (ctx) => [ctx.depleteAge],
    solve: (ctx, horizon, over) =>
      amortise(ctx, horizon, 1 + Math.max(0, Math.min(1, ctx.frontLoad)), 8, 1000, over),
    objective: (rows, ctx) => spreadOf(taxByYear(rows, ctx)),
  },
  {
    key: "levelTax",
    label: "Level tax dollars",
    blurb:
      "Keeps the tax bill as close to the same number of dollars each year as the RRIF minimums, LIF limits and spending targets allow.",
    horizons: (ctx) => [80, 85, ctx.endAge],
    solve: (ctx, horizon, over) => levellingSolve(ctx, taxByYear, 50, horizon, over),
    objective: (rows, ctx) => spreadOf(taxByYear(rows, ctx)),
    // Flatness must not be bought by leaving a balance for the estate.
    feasible: (rows) => terminalTax(rows) <= DRAINED_TOLERANCE,
  },
  {
    key: "levelRate",
    label: "Level tax rate",
    blurb:
      "Fills every year to the same effective rate and stops — the RRSP meltdown approach. Keeps income out of the bracket jumps and the OAS clawback band.",
    horizons: (ctx) => [80, 85, ctx.endAge],
    solve: (ctx, horizon, over) => levellingSolve(ctx, rateByYear, 0.0005, horizon, over),
    objective: (rows, ctx) => spreadOf(rateByYear(rows, ctx)),
    feasible: (rows) => terminalTax(rows) <= DRAINED_TOLERANCE,
  },
  {
    key: "minLifetime",
    label: "Minimise lifetime tax",
    blurb:
      "Searches shapes and depletion horizons for the lowest total tax, counting the bill on whatever is left at the end. Free to produce uneven years.",
    horizons: (ctx) => [80, 85, ctx.endAge, NEVER_DEPLETE],
    solve: (ctx, horizon, over) => minLifetimeSolve(ctx, horizon, over),
    objective: (rows) => lifetimeTax(rows) + terminalTax(rows),
  },
];

export type SolvedStrategy = {
  key: SmoothingMode;
  label: string;
  blurb: string;
  rows: WithdrawalScheduleRow[];
  plan: ExtraPlan;
  depleteByAge: number;
  lifMode: LifMode;
  summary: {
    lifetimeTax: number;
    terminalTax: number;
    taxSpread: number;
    rateSpread: number;
    peakTax: number;
  };
};

/**
 * Solve every strategy up front so switching between them in the UI is instant.
 *
 * The LIF setting is NOT a lever: every strategy takes the plan's setting (the
 * BC maximum by default), so the locked-in money is used up rather than left
 * behind, where it would be taxed on the second death at the top rate.
 */
export function solveAllStrategies(ctx: StrategyContext, lifMode: LifMode): Record<SmoothingMode, SolvedStrategy> {
  const out = {} as Record<SmoothingMode, SolvedStrategy>;

  for (const strategy of STRATEGIES) {
    let best:
      | { plan: ExtraPlan; rows: WithdrawalScheduleRow[]; score: number; feasible: boolean; depleteByAge: number }
      | null = null;

    for (const depleteByAge of [...new Set(strategy.horizons(ctx))]) {
      const overrides: SimulateOverrides = { lifMode, depleteByAge };
      const plan = strategy.solve(ctx, depleteByAge, overrides);
      const rows = ctx.simulate(plan, overrides);
      const score = strategy.objective(rows, ctx);
      const feasible = strategy.feasible ? strategy.feasible(rows) : true;
      // Feasibility first, then the strategy's own objective.
      const better =
        !best || (feasible && !best.feasible) || (feasible === best.feasible && score < best.score);
      if (better) best = { plan, rows, score, feasible, depleteByAge };
    }

    const { rows, plan, depleteByAge } = best!;
    const taxes = fullYears(rows, ctx).map((r) => r.debug.tax);
    out[strategy.key] = {
      key: strategy.key,
      label: strategy.label,
      blurb: strategy.blurb,
      rows,
      plan,
      depleteByAge,
      lifMode,
      summary: {
        lifetimeTax: lifetimeTax(rows),
        terminalTax: terminalTax(rows),
        taxSpread: spreadOf(taxByYear(rows, ctx)),
        rateSpread: spreadOf(rateByYear(rows, ctx)),
        peakTax: taxes.length ? Math.max(...taxes) : 0,
      },
    };
  }

  return out;
}
