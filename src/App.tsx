import { useMemo, useState } from "react";
import "./App.css";
import {
  DEFAULT_ANCHORS,
  DEFAULT_VARIABLES,
  type AccountBalances,
  type MonthlyContributions,
  type Variables,
} from "./planDefaults";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>{label}</div>
      {children}
    </label>
  );
}

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function sumBalances(b: AccountBalances) {
  return (
    b.fhsaShingo +
    b.fhsaSarah +
    b.rrspShingo +
    b.rrspSarah +
    b.tfsaShingo +
    b.tfsaSarah +
    b.liraShingo +
    b.nonRegistered
  );
}

function sumMonthly(m: MonthlyContributions) {
  return m.tfsaTotal + m.fhsaShingo + m.fhsaSarah + m.rrspShingo + m.rrspSarah;
}

function futureValueMonthly({
  pv,
  monthlyContribution,
  annualReturn,
  months,
}: {
  pv: number;
  monthlyContribution: number;
  annualReturn: number;
  months: number;
}) {
  const r = annualReturn / 12;
  if (months <= 0) return pv;
  if (Math.abs(r) < 1e-9) return pv + monthlyContribution * months;

  // FV = PV*(1+r)^n + PMT * ((1+r)^n - 1) / r
  const growth = Math.pow(1 + r, months);
  return pv * growth + monthlyContribution * ((growth - 1) / r);
}

export default function App() {
  const [vars, setVars] = useState<Variables>(DEFAULT_VARIABLES);

  const pensionAnnual =
    DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const cppAnnualAt70 = DEFAULT_ANCHORS.cppShingoAt70Monthly * 12;

  const baselineTotal = useMemo(() => sumBalances(vars.balances), [vars.balances]);
  const monthlyTotal = useMemo(() => sumMonthly(vars.monthly), [vars.monthly]);

  const snapshot = useMemo(() => {
    const yearsToRetirement =
      DEFAULT_ANCHORS.targetRetirementYear - DEFAULT_ANCHORS.baselineYear;
    const monthsToRetirement = Math.max(0, Math.round(yearsToRetirement * 12));

    const fvAtRetirement = futureValueMonthly({
      pv: baselineTotal,
      monthlyContribution: monthlyTotal,
      annualReturn: vars.nominalReturn,
      months: monthsToRetirement,
    });

    return {
      yearsToRetirement,
      monthsToRetirement,
      pensionAnnual,
      cppAnnualAt70,
      baselineTotal,
      monthlyTotal,
      fvAtRetirement,
    };
  }, [vars.nominalReturn, baselineTotal, monthlyTotal, pensionAnnual, cppAnnualAt70]);

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>RetirementResource</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>
          A retirement planning calculator (Canada / BC). Adjust levers (timing,
          contributions, return assumptions, spending phases) while keeping
          anchors explicit.
        </p>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <section className="card">
          <h2>Anchors (hard facts / slow-moving assumptions)</h2>
          <ul>
            <li>
              Location: <strong>{DEFAULT_ANCHORS.location}</strong>
            </li>
            <li>
              Baseline year: <strong>{DEFAULT_ANCHORS.baselineYear}</strong>
            </li>
            <li>
              Target retirement year: <strong>{DEFAULT_ANCHORS.targetRetirementYear}</strong>
            </li>
            <li>
              Indexed pension (annual): Shingo{" "}
              <strong>${money(DEFAULT_ANCHORS.pensionShingo)}</strong>, Sarah{" "}
              <strong>${money(DEFAULT_ANCHORS.pensionSarah)}</strong> (combined{" "}
              <strong>${money(pensionAnnual)}</strong>)
            </li>
            <li>
              CPP estimate: Shingo at 70 ≈{" "}
              <strong>${money(DEFAULT_ANCHORS.cppShingoAt70Monthly)}</strong>/mo
              (≈ <strong>${money(cppAnnualAt70)}</strong>/yr)
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>Current investments (baseline snapshot)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            Enter your current balances. These are the starting point for the
            model.
          </p>

          <div className="grid">
            <Field label="FHSA (Shingo)">
              <input
                type="number"
                value={vars.balances.fhsaShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, fhsaShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="FHSA (Sarah)">
              <input
                type="number"
                value={vars.balances.fhsaSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, fhsaSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="RRSP (Shingo)">
              <input
                type="number"
                value={vars.balances.rrspShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, rrspShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="RRSP (Sarah)">
              <input
                type="number"
                value={vars.balances.rrspSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, rrspSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="TFSA (Shingo)">
              <input
                type="number"
                value={vars.balances.tfsaShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, tfsaShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="TFSA (Sarah)">
              <input
                type="number"
                value={vars.balances.tfsaSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, tfsaSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="LIRA (Shingo)">
              <input
                type="number"
                value={vars.balances.liraShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: { ...v.balances, liraShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Non-registered">
              <input
                type="number"
                value={vars.balances.nonRegistered}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    balances: {
                      ...v.balances,
                      nonRegistered: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
          </div>

          <div style={{ marginTop: 12, fontSize: 13 }}>
            Total investments (baseline): <strong>${money(snapshot.baselineTotal)}</strong>
          </div>
        </section>

        <section className="card">
          <h2>Monthly investing (current)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            From your screenshot. For now, we treat this as a single total cash
            flow into investments.
          </p>

          <div className="grid">
            <Field label="TFSA (total)">
              <input
                type="number"
                value={vars.monthly.tfsaTotal}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthly: { ...v.monthly, tfsaTotal: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="FHSA (Shingo)">
              <input
                type="number"
                value={vars.monthly.fhsaShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthly: { ...v.monthly, fhsaShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="FHSA (Sarah)">
              <input
                type="number"
                value={vars.monthly.fhsaSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthly: { ...v.monthly, fhsaSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="RRSP (Shingo)">
              <input
                type="number"
                value={vars.monthly.rrspShingo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthly: { ...v.monthly, rrspShingo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="RRSP (Sarah)">
              <input
                type="number"
                value={vars.monthly.rrspSarah}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthly: { ...v.monthly, rrspSarah: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>

          <div style={{ marginTop: 12, fontSize: 13 }}>
            Total monthly investing: <strong>${money(snapshot.monthlyTotal)}</strong>
          </div>
        </section>

        <section className="card">
          <h2>Levers (things we change / stress-test)</h2>
          <div className="grid">
            <Field label="Retire age — Shingo">
              <input
                type="number"
                value={vars.shingoRetireAge}
                onChange={(e) =>
                  setVars((v) => ({ ...v, shingoRetireAge: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="Retire age — Sarah">
              <input
                type="number"
                value={vars.sarahRetireAge}
                onChange={(e) =>
                  setVars((v) => ({ ...v, sarahRetireAge: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="CPP start age">
              <input
                type="number"
                value={vars.cppStartAge}
                onChange={(e) =>
                  setVars((v) => ({ ...v, cppStartAge: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="OAS start age">
              <input
                type="number"
                value={vars.oasStartAge}
                onChange={(e) =>
                  setVars((v) => ({ ...v, oasStartAge: num(e.target.value) }))
                }
              />
            </Field>
            <Field label="Nominal return assumption (e.g. 0.07 = 7%)">
              <input
                type="number"
                step="0.001"
                value={vars.nominalReturn}
                onChange={(e) =>
                  setVars((v) => ({ ...v, nominalReturn: num(e.target.value) }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 16 }}>Spending phases (annual targets)</h3>
          <div className="grid">
            <Field label="Go-Go (annual)">
              <input
                type="number"
                value={vars.spending.goGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, goGo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="Slow-Go (annual)">
              <input
                type="number"
                value={vars.spending.slowGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, slowGo: num(e.target.value) },
                  }))
                }
              />
            </Field>
            <Field label="No-Go (annual)">
              <input
                type="number"
                value={vars.spending.noGo}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    spending: { ...v.spending, noGo: num(e.target.value) },
                  }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>Projection to retirement (simple v1)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This is a simple compounding model on total investments from baseline
            year → retirement year. Next iteration will model each account and
            withdrawal rules.
          </p>
          <ul>
            <li>
              Time horizon: <strong>{snapshot.yearsToRetirement}</strong> years ({snapshot.monthsToRetirement} months)
            </li>
            <li>
              Baseline total: <strong>${money(snapshot.baselineTotal)}</strong>
            </li>
            <li>
              Monthly investing (total): <strong>${money(snapshot.monthlyTotal)}</strong>
            </li>
            <li>
              Nominal return: <strong>{(vars.nominalReturn * 100).toFixed(2)}%</strong>
            </li>
            <li>
              Projected total at retirement (pre-tax, simplified):{" "}
              <strong>${money(snapshot.fvAtRetirement)}</strong>
            </li>
          </ul>
        </section>
      </div>

      <footer style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        <div>
          Design truth: income-first (pension/CPP/OAS carry the plan) + flexibility
          &gt; optimization.
        </div>
      </footer>
    </div>
  );
}
