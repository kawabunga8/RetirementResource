import { useMemo, useState } from "react";
import "./App.css";
import { DEFAULT_ANCHORS, DEFAULT_VARIABLES, type Variables } from "./planDefaults";

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

export default function App() {
  const [vars, setVars] = useState<Variables>(DEFAULT_VARIABLES);

  const pensionAnnual =
    DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const cppAnnualAt70 = DEFAULT_ANCHORS.cppShingoAt70Monthly * 12;

  const snapshot = useMemo(() => {
    // Not a full retirement model yet.
    // This is a “calculator scaffold” that keeps anchors vs levers explicit.
    const rrspAnnualContribution = vars.monthlyRrspContribution * 12;

    return {
      rrspAnnualContribution,
      pensionAnnual,
      cppAnnualAt70,
    };
  }, [vars, pensionAnnual, cppAnnualAt70]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>RetirementResource</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>
          A retirement planning calculator (Canada / BC) focused on manipulable
          levers (timing, contributions, returns, spending phases) vs anchors
          (pensions/CPP/OAS assumptions).
        </p>
      </header>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 16,
        }}
      >
        <section className="card">
          <h2>Anchors (hard facts / slow-moving assumptions)</h2>
          <ul>
            <li>
              Location: <strong>{DEFAULT_ANCHORS.location}</strong>
            </li>
            <li>
              Target retirement year: <strong>{DEFAULT_ANCHORS.targetRetirementYear}</strong>
            </li>
            <li>
              Indexed pension (annual): Shingo <strong>${DEFAULT_ANCHORS.pensionShingo.toLocaleString()}</strong>, Sarah{" "}
              <strong>${DEFAULT_ANCHORS.pensionSarah.toLocaleString()}</strong> (combined{" "}
              <strong>${pensionAnnual.toLocaleString()}</strong>)
            </li>
            <li>
              CPP estimate: Shingo at 70 ≈ <strong>${DEFAULT_ANCHORS.cppShingoAt70Monthly.toLocaleString()}</strong>/mo (≈{" "}
              <strong>${cppAnnualAt70.toLocaleString()}</strong>/yr)
            </li>
          </ul>
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
            <Field label="RRSP contribution (monthly, household)">
              <input
                type="number"
                value={vars.monthlyRrspContribution}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    monthlyRrspContribution: num(e.target.value),
                  }))
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
          <h2>Quick computed snapshot (scaffold)</h2>
          <ul>
            <li>
              RRSP contribution (annual): <strong>${snapshot.rrspAnnualContribution.toLocaleString()}</strong>
            </li>
            <li>
              Pension income (annual): <strong>${snapshot.pensionAnnual.toLocaleString()}</strong>
            </li>
            <li>
              CPP (Shingo at 70, annual): <strong>${snapshot.cppAnnualAt70.toLocaleString()}</strong>
            </li>
          </ul>
          <p style={{ fontSize: 12, opacity: 0.8 }}>
            Next: model balances (RRSP/LIRA/TFSA), withdrawals (RRIF/LIF), tax
            brackets, and phase-based spending.
          </p>
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
