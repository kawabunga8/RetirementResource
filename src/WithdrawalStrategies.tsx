import { useEffect, useMemo, useRef, useState } from "react";
import { makeWithdrawalSimulator, type SimulatorParams, type WithdrawalScheduleRow } from "./withdrawals/engine";
import {
  solveAllStrategies,
  NEVER_DEPLETE,
  type SmoothingMode,
  type SolvedStrategy,
  type StrategyContext,
} from "./withdrawals/strategies";

type Props = {
  params: SimulatorParams;
  /** Show today's dollars rather than nominal. */
  real: boolean;
  /** Set the plan's deplete-by age. Only the "Deplete by" strategy uses it. */
  onChangeDepleteAge?: (age: number) => void;
};

/**
 * STACK ORDER, BOTTOM FIRST. The chart accumulates in array order, so SERIES[0]
 * is drawn against the axis and the last entry sits on top. Read top-down the
 * bars now go salary, RRSP/RRIF, CPP+OAS, LIF, pension -- the income you cannot
 * change at the bottom, the income the strategy actually moves on top, so the
 * part that differs between strategies is the part against the skyline.
 *
 * Reordering this array reorders the bars. Nothing else depends on it: the
 * total is an order-free sum, and the legend and tooltip read LEGEND below.
 */
const SERIES = [
  { key: "pension", label: "Employer pensions", color: "#eb6834" },
  { key: "lif", label: "LIF", color: "#e87ba4" },
  { key: "cppOas", label: "CPP + OAS", color: "#1baf7a" },
  { key: "rrif", label: "RRSP / RRIF", color: "#eda100" },
  { key: "salary", label: "Employment income", color: "#2a78d6" },
] as const;

/**
 * Legend and tooltip run top-of-stack first, so scanning them left to right
 * matches reading the bar top to bottom.
 */
const LEGEND = [...SERIES].reverse();

type SeriesKey = (typeof SERIES)[number]["key"];
type Point = Record<SeriesKey, number> & {
  year: number;
  total: number;
  tax: number;
  target: number;
};

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-CA");
const fmtK = (n: number) => (n === 0 ? "$0" : "$" + Math.round(n / 1000) + "k");

function toPoint(r: WithdrawalScheduleRow): Point {
  const d = r.incomeDetail;
  const o = {
    year: r.year,
    salary: d.employmentShingo + d.employmentSarah,
    pension: d.pensionShingo + d.pensionSarah,
    cppOas: d.cppShingo + d.cppSarah + d.oasShingo + d.oasSarah,
    rrif: r.withdrawals.rrsp + r.withdrawals.fhsa,
    lif: r.withdrawals.lira,
    // Total household tax for the year, every source included — in the
    // retirement year that means the salary's own tax as well.
    tax: r.debug.tax + r.debug.taxOnEmployment,
    target: r.targetAfterTaxSpending,
    total: 0,
  };
  o.total = SERIES.reduce((a, s) => a + o[s.key], 0);
  return o;
}

/**
 * Four strategies, solved off the critical path.
 *
 * Each solve runs the 26-year model many times over, and every year of it calls
 * the tax engine with the splitting optimiser, so four of them take a couple of
 * seconds. Running that on every keystroke would lock the page, so the solve is
 * debounced and the previous result stays on screen until the new one lands.
 */
function useSolvedStrategies(params: SimulatorParams) {
  const [solved, setSolved] = useState<Record<SmoothingMode, SolvedStrategy> | null>(null);
  const [solving, setSolving] = useState(true);
  const timer = useRef<number | undefined>(undefined);

  const { vars, anchors, retirementYear, retirementBalances, tfsaRoomAtRetirement } = params;

  useEffect(() => {
    setSolving(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const simulate = makeWithdrawalSimulator(params);
      const ctx: StrategyContext = {
        simulate,
        retirementYear,
        depleteAge: vars.withdrawals.rrifDepleteByAge,
        endAge: vars.phaseAges.endAge,
        frontLoad: vars.withdrawals.rrifFrontLoad,
        growth: vars.retirementNominalReturn ?? vars.expectedNominalReturn,
        rrspAtRetirement:
          retirementBalances.rrsp +
          (vars.withdrawals.rollFhsaIntoRrspAtRetirement ? retirementBalances.fhsa : 0),
        skipRetirementYear: false,
      };
      setSolved(solveAllStrategies(ctx, vars.withdrawals.lifMode));
      setSolving(false);
    }, 350);

    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vars, anchors, retirementYear, retirementBalances, tfsaRoomAtRetirement]);

  return { solved, solving };
}

function Chart({ points, yMax }: { points: Point[]; yMax: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 14, right: 14, bottom: 42, left: 72 };
  const VW = 1000;
  const VH = 400;
  const PW = VW - M.left - M.right;
  const PH = VH - M.top - M.bottom;
  const band = PW / Math.max(1, points.length);
  const barW = Math.min(26, band * 0.68);
  const yOf = (v: number) => M.top + PH - (v / yMax) * PH;

  const hovered = hover == null ? null : points[hover];

  return (
    <div style={{ position: "relative" }}>
      <div style={{ overflowX: "auto" }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          style={{ display: "block", width: "100%", minWidth: 620, height: "auto" }}
          role="img"
          aria-label="Annual retirement income by source"
        >
          {[0, 1, 2, 3, 4].map((i) => {
            const v = (yMax / 4) * i;
            const y = yOf(v);
            return (
              <g key={i}>
                <line x1={M.left} x2={M.left + PW} y1={y} y2={y} stroke={i === 0 ? "#c3c2b7" : "#e5e7eb"} strokeWidth={1} />
                <text x={M.left - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#6b7280">
                  {fmtK(v)}
                </text>
              </g>
            );
          })}

          {points.map((p, i) => {
            const x = M.left + band * i + (band - barW) / 2;
            let acc = 0;
            return (
              <g key={p.year}>
                {SERIES.map((s) => {
                  const val = p[s.key];
                  if (val <= 1) return null;
                  const y0 = acc;
                  acc += val;
                  return (
                    <rect
                      key={s.key}
                      x={x}
                      y={yOf(acc)}
                      width={barW}
                      height={Math.max(1, yOf(y0) - yOf(acc))}
                      fill={s.color}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                    />
                  );
                })}
              </g>
            );
          })}

          <polyline
            fill="none"
            stroke="#52514e"
            strokeWidth={2}
            strokeDasharray="7 5"
            points={points.map((p, i) => `${M.left + band * i + band / 2},${yOf(p.target)}`).join(" ")}
          />

          {/* Tax paid, on the same dollar axis as the bars. It sits low by
              design: the point is its SHAPE across the years, which is what
              every strategy here is trying to change. */}
          <polyline
            fill="none"
            stroke="#0b0b0b"
            strokeWidth={2}
            strokeLinejoin="round"
            points={points.map((p, i) => `${M.left + band * i + band / 2},${yOf(p.tax)}`).join(" ")}
          />
          {points.map((p, i) => (
            <circle
              key={`tax-${p.year}`}
              cx={M.left + band * i + band / 2}
              cy={yOf(p.tax)}
              r={3}
              fill="#0b0b0b"
              stroke="#ffffff"
              strokeWidth={1.5}
            />
          ))}

          {points.map((p, i) => {
            const show = i === 0 || i === points.length - 1 || (p.year % 5 === 0 && i < points.length - 2);
            if (!show) return null;
            return (
              <text key={p.year} x={M.left + band * i + band / 2} y={M.top + PH + 18} textAnchor="middle" fontSize={11} fill="#6b7280">
                {p.year}
              </text>
            );
          })}

          {points.map((p, i) => (
            <rect
              key={`hit-${p.year}`}
              x={M.left + band * i}
              y={M.top}
              width={band}
              height={PH}
              fill={hover === i ? "rgba(15,23,42,0.06)" : "transparent"}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>

      {hovered ? (
        <div style={{ marginTop: 8, fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
          <strong>{hovered.year}</strong>
          {LEGEND.filter((s) => hovered[s.key] > 1).map((s) => (
            <span key={s.key} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <i style={{ width: 10, height: 10, borderRadius: 3, background: s.color, display: "inline-block" }} />
              {s.label}: <strong>{fmt(hovered[s.key])}</strong>
            </span>
          ))}
          <span>Total: <strong>{fmt(hovered.total)}</strong></span>
          <span>Tax: <strong>{fmt(hovered.tax)}</strong></span>
          <span>Target: <strong>{fmt(hovered.target)}</strong></span>
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Hover a year for the breakdown.</div>
      )}
    </div>
  );
}

export function WithdrawalStrategies({ params, real, onChangeDepleteAge }: Props) {
  const { solved, solving } = useSolvedStrategies(params);
  const [mode, setMode] = useState<SmoothingMode>("depleteBy");

  const deflate = useMemo(() => {
    const rate = params.vars.expectedInflation;
    const base = params.anchors.baselineYear;
    return (v: number, year: number) => (real ? v / Math.pow(1 + rate, Math.max(0, year - base)) : v);
  }, [real, params.vars.expectedInflation, params.anchors.baselineYear]);

  const chart = useMemo(() => {
    if (!solved) return null;
    const points = solved[mode].rows.map((r) => {
      const p = toPoint(r);
      const out = { ...p } as Point;
      for (const s of SERIES) out[s.key] = deflate(p[s.key], p.year);
      out.total = deflate(p.total, p.year);
      out.tax = deflate(p.tax, p.year);
      out.target = deflate(p.target, p.year);
      return out;
    });
    // One axis across every strategy, so the bars stay comparable on switch.
    const max = Math.max(
      ...Object.values(solved).flatMap((s) =>
        s.rows.map((r) => deflate(toPoint(r).total, r.year))
      )
    );
    const step = Math.pow(10, Math.floor(Math.log10(max))) / 2;
    return { points, yMax: Math.ceil(max / step) * step };
  }, [solved, mode, deflate]);

  if (!solved || !chart) {
    return (
      <div style={{ marginTop: 18, padding: 16, border: "1px solid #e5e7eb", borderRadius: 10, fontSize: 13, opacity: 0.8 }}>
        Solving four withdrawal strategies…
      </div>
    );
  }

  const depleteAge = params.vars.withdrawals.rrifDepleteByAge;
  const chosen = solved[mode];
  const base = solved.depleteBy.summary;
  const s = chosen.summary;

  const horizonLabel =
    chosen.depleteByAge >= NEVER_DEPLETE
      ? "no forced depletion — RRIF minimums only"
      : `RRSP drained by age ${chosen.depleteByAge}`;

  const delta = (value: number, baseline: number) => {
    if (mode === "depleteBy") return "the baseline";
    const diff = value - baseline;
    if (Math.abs(diff) < 1) return "same as baseline";
    return `${diff < 0 ? "−" : "+"}${fmt(Math.abs(diff))} vs baseline`;
  };

  const cards: { k: string; v: string; n: string; good: boolean }[] = [
    { k: "Lifetime tax", v: fmt(s.lifetimeTax), n: delta(s.lifetimeTax, base.lifetimeTax), good: s.lifetimeTax < base.lifetimeTax },
    {
      k: "Left taxable at the end",
      v: fmt(s.terminalTax),
      n: s.terminalTax > 1 ? "payable on the second death" : "registered accounts fully drawn down",
      good: s.terminalTax <= 1,
    },
    { k: "Year-to-year spread", v: fmt(s.taxSpread), n: delta(s.taxSpread, base.taxSpread), good: s.taxSpread < base.taxSpread },
    { k: "Heaviest year", v: fmt(s.peakTax), n: delta(s.peakTax, base.peakTax), good: s.peakTax < base.peakTax },
  ];

  return (
    <div style={{ marginTop: 22 }}>
      <h3 style={{ marginBottom: 4 }}>Withdrawal strategy</h3>
      <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
        All four are solved up front, so switching is instant, and all four now steer around the
        OAS clawback. Only <em>Deplete by {depleteAge}</em> is bound to your deplete-by age; the
        others pick their own horizon, which is the only real freedom between them — a shorter
        deadline means the same money leaves in fewer years. None of them uses the front-load
        setting.
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {(Object.values(solved) as SolvedStrategy[]).map((st) => (
          <button
            key={st.key}
            type="button"
            onClick={() => setMode(st.key)}
            style={{
              padding: "7px 14px",
              borderRadius: 999,
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 13,
              border: `1px solid ${mode === st.key ? "#2a78d6" : "#e5e7eb"}`,
              background: mode === st.key ? "#2a78d6" : "#ffffff",
              color: mode === st.key ? "#ffffff" : "#374151",
              fontWeight: mode === st.key ? 600 : 400,
            }}
          >
            {st.key === "depleteBy" ? `Deplete by ${depleteAge}` : st.label}
          </button>
        ))}
        {onChangeDepleteAge ? (
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, opacity: 0.85, marginLeft: 4 }}>
            Deplete by age
            <input
              type="number"
              min={71}
              max={95}
              value={depleteAge}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                if (Number.isFinite(n) && n >= 71 && n <= 95) onChangeDepleteAge(n);
              }}
              style={{ width: 58, padding: "3px 6px", fontSize: 12 }}
            />
          </label>
        ) : null}
        {solving ? <span style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>re-solving…</span> : null}
      </div>

      <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 12 }}>
        {chosen.blurb}{" "}
        <span style={{ opacity: 0.7 }}>
          Chosen: {horizonLabel} · LIF {chosen.lifMode} (fixed).
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginBottom: 14 }}>
        {cards.map((c) => (
          <div key={c.k} style={{ border: "1px solid #e5e7eb", background: "#f8fafc", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.6, fontWeight: 600 }}>{c.k}</div>
            <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2 }}>{c.v}</div>
            <div style={{ fontSize: 12, marginTop: 2, color: c.good && mode !== "depleteBy" ? "#0ca30c" : "#6b7280" }}>{c.n}</div>
          </div>
        ))}
      </div>

      <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 10, fontSize: 12 }}>
          {LEGEND.map((sr) => (
            <span key={sr.key} style={{ display: "inline-flex", gap: 7, alignItems: "center" }}>
              <i style={{ width: 11, height: 11, borderRadius: 3, background: sr.color, display: "inline-block" }} />
              {sr.label}
            </span>
          ))}
          <span style={{ display: "inline-flex", gap: 7, alignItems: "center" }}>
            <i style={{ width: 16, height: 0, borderTop: "2px dashed #52514e", display: "inline-block" }} />
            Spending target (after-tax)
          </span>
          <span style={{ display: "inline-flex", gap: 7, alignItems: "center" }}>
            <i style={{ width: 16, height: 0, borderTop: "2px solid #0b0b0b", display: "inline-block" }} />
            Tax paid
          </span>
        </div>
        <Chart points={chart.points} yMax={chart.yMax} />
      </div>
    </div>
  );
}
