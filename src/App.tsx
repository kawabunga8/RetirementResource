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

function toRealDollars(nominal: number, annualInflation: number, years: number) {
  if (years <= 0) return nominal;
  const d = Math.pow(1 + annualInflation, years);
  if (!Number.isFinite(d) || d === 0) return nominal;
  return nominal / d;
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

    // Split the TFSA total contribution 50/50 for now (adjust later if you want).
    const tfsaMonthlyEach = vars.monthly.tfsaTotal / 2;

    const fvByAccount = {
      fhsaShingo: futureValueMonthly({
        pv: vars.balances.fhsaShingo,
        monthlyContribution: vars.monthly.fhsaShingo,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      fhsaSarah: futureValueMonthly({
        pv: vars.balances.fhsaSarah,
        monthlyContribution: vars.monthly.fhsaSarah,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      rrspShingo: futureValueMonthly({
        pv: vars.balances.rrspShingo,
        monthlyContribution: vars.monthly.rrspShingo,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      rrspSarah: futureValueMonthly({
        pv: vars.balances.rrspSarah,
        monthlyContribution: vars.monthly.rrspSarah,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      tfsaShingo: futureValueMonthly({
        pv: vars.balances.tfsaShingo,
        monthlyContribution: tfsaMonthlyEach,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      tfsaSarah: futureValueMonthly({
        pv: vars.balances.tfsaSarah,
        monthlyContribution: tfsaMonthlyEach,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      // Assume no ongoing contributions into locked-in/non-reg for now.
      liraShingo: futureValueMonthly({
        pv: vars.balances.liraShingo,
        monthlyContribution: 0,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
      nonRegistered: futureValueMonthly({
        pv: vars.balances.nonRegistered,
        monthlyContribution: 0,
        annualReturn: vars.expectedNominalReturn,
        months: monthsToRetirement,
      }),
    };

    const totalNominalAtRetirement =
      fvByAccount.fhsaShingo +
      fvByAccount.fhsaSarah +
      fvByAccount.rrspShingo +
      fvByAccount.rrspSarah +
      fvByAccount.tfsaShingo +
      fvByAccount.tfsaSarah +
      fvByAccount.liraShingo +
      fvByAccount.nonRegistered;

    const totalRealAtRetirement = toRealDollars(
      totalNominalAtRetirement,
      vars.expectedInflation,
      yearsToRetirement
    );

    return {
      yearsToRetirement,
      monthsToRetirement,
      pensionAnnual,
      cppAnnualAt70,
      baselineTotal,
      monthlyTotal,
      fvByAccount,
      totalNominalAtRetirement,
      totalRealAtRetirement,
    };
  }, [
    vars,
    baselineTotal,
    monthlyTotal,
    pensionAnnual,
    cppAnnualAt70,
  ]);

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
            Current monthly contributions by account.
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
          <h2>Expectations (adjustable)</h2>
          <div className="grid">
            <Field label="Expected nominal return (e.g. 0.07 = 7%)">
              <input
                type="number"
                step="0.001"
                value={vars.expectedNominalReturn}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    expectedNominalReturn: num(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Expected inflation (e.g. 0.02 = 2%)">
              <input
                type="number"
                step="0.001"
                value={vars.expectedInflation}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    expectedInflation: num(e.target.value),
                  }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="card">
          <h2>Starting balances at retirement (projected)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            Nominal projections by account at retirement year (baseline →
            retirement). TFSA contributions are split 50/50 for now.
          </p>
          <ul>
            <li>
              FHSA (Shingo): <strong>${money(snapshot.fvByAccount.fhsaShingo)}</strong>
            </li>
            <li>
              FHSA (Sarah): <strong>${money(snapshot.fvByAccount.fhsaSarah)}</strong>
            </li>
            <li>
              RRSP (Shingo): <strong>${money(snapshot.fvByAccount.rrspShingo)}</strong>
            </li>
            <li>
              RRSP (Sarah): <strong>${money(snapshot.fvByAccount.rrspSarah)}</strong>
            </li>
            <li>
              TFSA (Shingo): <strong>${money(snapshot.fvByAccount.tfsaShingo)}</strong>
            </li>
            <li>
              TFSA (Sarah): <strong>${money(snapshot.fvByAccount.tfsaSarah)}</strong>
            </li>
            <li>
              LIRA (Shingo): <strong>${money(snapshot.fvByAccount.liraShingo)}</strong>
            </li>
            <li>
              Non-registered: <strong>${money(snapshot.fvByAccount.nonRegistered)}</strong>
            </li>
          </ul>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>
              Total (nominal): <strong>${money(snapshot.totalNominalAtRetirement)}</strong>
            </div>
            <div style={{ fontSize: 13 }}>
              Total (in today’s dollars, using inflation):{" "}
              <strong>${money(snapshot.totalRealAtRetirement)}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Spending phases (annual targets)</h2>
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
            Simple compounding from baseline year → retirement year.
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
              Expected nominal return: <strong>{(vars.expectedNominalReturn * 100).toFixed(2)}%</strong>
            </li>
            <li>
              Expected inflation: <strong>{(vars.expectedInflation * 100).toFixed(2)}%</strong>
            </li>
            <li>
              Total at retirement (nominal):{" "}
              <strong>${money(snapshot.totalNominalAtRetirement)}</strong>
            </li>
            <li>
              Total at retirement (today’s dollars):{" "}
              <strong>${money(snapshot.totalRealAtRetirement)}</strong>
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
