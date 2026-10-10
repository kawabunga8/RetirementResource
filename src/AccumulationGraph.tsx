import { timelineTicks, monthLabel, type TimelinePoint } from "./accumulationTimeline";

const SERIES = [
  { key: "fhsa", label: "FHSA", color: "#22c55e" },
  { key: "rrsp", label: "RRSP", color: "#3b82f6" },
  { key: "tfsa", label: "TFSA", color: "#a855f7" },
  { key: "lif", label: "LIF", color: "#f59e0b" },
  { key: "nonReg", label: "NonReg", color: "#64748b" },
] as const;

type SeriesKey = (typeof SERIES)[number]["key"];

/**
 * Stacked balances by account from today to the retirement month, plus a total
 * line. Points sit at the month they describe (see accumulationTimeline).
 */
export function AccumulationGraph(props: {
  points: TimelinePoint[];
  /** Converts a nominal amount to the dollars the page is showing. */
  adjustDollars: (amountNominal: number, year: number) => number;
  formatMoney: (n: number) => string;
}) {
  const { points, adjustDollars, formatMoney } = props;
  if (points.length === 0) return null;

  const W = 820;
  const H = 260;
  const padL = 52;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  const xMin = points[0].month;
  const xMax = points[points.length - 1].month;

  const stacks = points.map((p) => {
    const v: Record<SeriesKey, number> = {
      fhsa: adjustDollars(p.fhsa, p.dollarsYear),
      rrsp: adjustDollars(p.rrsp, p.dollarsYear),
      tfsa: adjustDollars(p.tfsa, p.dollarsYear),
      lif: adjustDollars(p.lif, p.dollarsYear),
      nonReg: adjustDollars(p.nonReg, p.dollarsYear),
    };
    const cum = {} as Record<SeriesKey, number>;
    let acc = 0;
    for (const s of SERIES) {
      acc += v[s.key];
      cum[s.key] = acc;
    }
    return { month: p.month, total: acc, cum };
  });

  const yMin = 0;
  const yMax = Math.max(...stacks.map((p) => p.total), 1);

  const xScale = (m: number) => padL + ((m - xMin) / Math.max(1, xMax - xMin)) * (W - padL - padR);
  const yScale = (y: number) => padT + (1 - (y - yMin) / Math.max(1, yMax - yMin)) * (H - padT - padB);

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`).join(" ");

  const areaPath = (key: SeriesKey, prevKey?: SeriesKey) => {
    const top = stacks.map((p) => ({ x: xScale(p.month), y: yScale(p.cum[key]) }));
    const base = stacks
      .slice()
      .reverse()
      .map((p) => ({ x: xScale(p.month), y: yScale(prevKey ? p.cum[prevKey] : 0) }));
    return toPath(top.concat(base)) + " Z";
  };

  const linePath = (key: SeriesKey) => toPath(stacks.map((p) => ({ x: xScale(p.month), y: yScale(p.cum[key]) })));
  const totalPath = toPath(stacks.map((p) => ({ x: xScale(p.month), y: yScale(p.total) })));

  const ticks = timelineTicks(xMin, xMax);
  const start = stacks[0];
  const end = stacks[stacks.length - 1];

  const yTickCount = 5;
  const yTicks: number[] = [];
  for (let i = 0; i < yTickCount; i++) yTicks.push((yMax * (yTickCount - 1 - i)) / (yTickCount - 1));

  return (
    <div style={{ marginTop: 10, overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", minWidth: 560, display: "block" }}>
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="#e5e7eb" />
        <line x1={padL} y1={padT} x2={padL} y2={H - padB} stroke="#e5e7eb" />

        {/* stacked shaded areas */}
        {SERIES.map((s, idx) => (
          <path
            key={s.key}
            d={areaPath(s.key, idx === 0 ? undefined : SERIES[idx - 1].key)}
            fill={s.color}
            opacity={0.12}
            stroke="none"
          />
        ))}

        {/* boundary lines for each stack */}
        {SERIES.map((s) => (
          <path key={`line-${s.key}`} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={1.5} opacity={0.9} />
        ))}

        {/* total line */}
        <path d={totalPath} fill="none" stroke="#0f172a" strokeWidth={2.5} />

        {/* time ticks: today, 1 January of the years between, retirement month */}
        {ticks.map((t, i) => {
          const x = xScale(t.month);
          const anchor = i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle";
          return (
            <g key={`tick-${t.month}`}>
              <line x1={x} y1={H - padB} x2={x} y2={H - padB + 4} stroke="#cbd5e1" />
              <text x={x} y={H - 10} fontSize={12} fill="#64748b" textAnchor={anchor}>
                {t.label}
              </text>
            </g>
          );
        })}
        {/* y-axis gridlines and labels */}
        {yTicks.map((v, i) => {
          const y = yScale(v);
          const isTop = i === 0;
          const isBottom = i === yTicks.length - 1;
          return (
            <g key={`y-${i}`}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" />
              <text x={padL} y={isTop ? y + 10 : isBottom ? y - 6 : y + 4} fontSize={12} fill="#64748b" textAnchor="start">
                {formatMoney(v)}
              </text>
            </g>
          );
        })}

      </svg>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12, marginTop: 8 }}>
        {SERIES.map((s) => (
          <div key={`legend-${s.key}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, background: s.color, display: "inline-block", borderRadius: 2, opacity: 0.8 }} />
            <span style={{ opacity: 0.85 }}>{s.label}</span>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 2, background: "#0f172a", display: "inline-block" }} />
          <span style={{ opacity: 0.85 }}>Total</span>
        </div>
      </div>

      {/* Values are already in the page's dollars: formatting them again
          through the dollars toggle used to take inflation off twice. */}
      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
        {monthLabel(start.month)}: <strong>${formatMoney(start.total)}</strong> → {monthLabel(end.month)}:{" "}
        <strong>${formatMoney(end.total)}</strong>
      </div>
    </div>
  );
}
