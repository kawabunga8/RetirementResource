import { useMemo, useState } from "react";
import "./App.css";
import {
  DEFAULT_ANCHORS,
  DEFAULT_VARIABLES,
  type AccountBalances,
  type MonthlyContributions,
  type Variables,
  type WithdrawalOrder,
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

type RetirementBalances = {
  fhsa: number;
  rrsp: number;
  tfsa: number;
  lira: number;
  nonRegistered: number;
};

function clampToZero(n: number) {
  return n < 0 ? 0 : n;
}

function withdrawFrom(
  amount: number,
  balance: number,
  cap: number
): { withdrawn: number; remainingNeed: number; newBalance: number } {
  if (amount <= 0) return { withdrawn: 0, remainingNeed: 0, newBalance: balance };

  const allowed = cap > 0 ? Math.min(amount, cap) : amount;
  const withdrawn = Math.min(allowed, balance);
  return {
    withdrawn,
    remainingNeed: amount - withdrawn,
    newBalance: balance - withdrawn,
  };
}

export default function App() {
  const [vars, setVars] = useState<Variables>(DEFAULT_VARIABLES);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pensionAnnual =
    DEFAULT_ANCHORS.pensionShingo + DEFAULT_ANCHORS.pensionSarah;

  const baselineTotal = useMemo(() => sumBalances(vars.balances), [vars.balances]);
  const monthlyTotal = useMemo(() => sumMonthly(vars.monthly), [vars.monthly]);

  const model = useMemo(() => {
    const yearsToRetirement =
      DEFAULT_ANCHORS.targetRetirementYear - DEFAULT_ANCHORS.baselineYear;
    const monthsToRetirement = Math.max(0, Math.round(yearsToRetirement * 12));

    // Split the TFSA total contribution 50/50 for now.
    const tfsaMonthlyEach = vars.monthly.tfsaTotal / 2;

    const atRetirementByAccount = {
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

    const retirementBalances: RetirementBalances = {
      fhsa: atRetirementByAccount.fhsaShingo + atRetirementByAccount.fhsaSarah,
      rrsp: atRetirementByAccount.rrspShingo + atRetirementByAccount.rrspSarah,
      tfsa: atRetirementByAccount.tfsaShingo + atRetirementByAccount.tfsaSarah,
      lira: atRetirementByAccount.liraShingo,
      nonRegistered: atRetirementByAccount.nonRegistered,
    };

    const totalNominalAtRetirement =
      retirementBalances.fhsa +
      retirementBalances.rrsp +
      retirementBalances.tfsa +
      retirementBalances.lira +
      retirementBalances.nonRegistered;

    const totalRealAtRetirement = toRealDollars(
      totalNominalAtRetirement,
      vars.expectedInflation,
      yearsToRetirement
    );

    // --- Withdrawal schedule (simple v1) ---
    const retireYear = DEFAULT_ANCHORS.targetRetirementYear;
    const retireAgeShingo = vars.shingoRetireAge;
    const retireAgeSarah = vars.sarahRetireAge;

    const yearsInPlan = Math.max(0, vars.phaseAges.endAge - Math.min(retireAgeShingo, retireAgeSarah) + 1);

    const rows: Array<{
      year: number;
      ageShingo: number;
      ageSarah: number;
      phase: "Go-Go" | "Slow-Go" | "No-Go";
      targetSpending: number;
      guaranteedIncome: number;
      benefitsIncome: number;
      gap: number;
      withdrawals: Record<string, number>;
      endBalances: RetirementBalances;
    }> = [];

    let balances: RetirementBalances = { ...retirementBalances };

    for (let i = 0; i < yearsInPlan; i++) {
      const year = retireYear + i;
      const ageShingo = retireAgeShingo + i;
      const ageSarah = retireAgeSarah + i;

      const phase: "Go-Go" | "Slow-Go" | "No-Go" =
        ageShingo <= vars.phaseAges.goGoEndAge ? "Go-Go" : ageShingo <= vars.phaseAges.slowGoEndAge ? "Slow-Go" : "No-Go";

      const targetSpending =
        phase === "Go-Go"
          ? vars.spending.goGo
          : phase === "Slow-Go"
            ? vars.spending.slowGo
            : vars.spending.noGo;

      const guaranteedIncome = pensionAnnual;

      const benefitsIncome =
        (ageShingo >= vars.cppStartAge ? vars.withdrawals.cppShingoAnnual : 0) +
        (ageSarah >= vars.cppStartAge ? vars.withdrawals.cppSarahAnnual : 0) +
        (ageShingo >= vars.oasStartAge ? vars.withdrawals.oasShingoAnnual : 0) +
        (ageSarah >= vars.oasStartAge ? vars.withdrawals.oasSarahAnnual : 0);

      let gap = clampToZero(targetSpending - guaranteedIncome - benefitsIncome);

      const withdrawals: Record<string, number> = {
        fhsa: 0,
        rrsp: 0,
        lira: 0,
        nonRegistered: 0,
        tfsa: 0,
      };

      for (const src of vars.withdrawals.order) {
        if (gap <= 0) break;

        if (src === "tfsa" && !vars.withdrawals.allowTfsa) continue;
        if (src === "pension") continue;

        if (src === "fhsa") {
          const r = withdrawFrom(gap, balances.fhsa, vars.withdrawals.caps.fhsa);
          withdrawals.fhsa += r.withdrawn;
          balances.fhsa = r.newBalance;
          gap = r.remainingNeed;
        } else if (src === "rrsp") {
          const r = withdrawFrom(gap, balances.rrsp, vars.withdrawals.caps.rrsp);
          withdrawals.rrsp += r.withdrawn;
          balances.rrsp = r.newBalance;
          gap = r.remainingNeed;
        } else if (src === "lira") {
          const r = withdrawFrom(gap, balances.lira, vars.withdrawals.caps.lira);
          withdrawals.lira += r.withdrawn;
          balances.lira = r.newBalance;
          gap = r.remainingNeed;
        } else if (src === "nonRegistered") {
          const r = withdrawFrom(
            gap,
            balances.nonRegistered,
            vars.withdrawals.caps.nonRegistered
          );
          withdrawals.nonRegistered += r.withdrawn;
          balances.nonRegistered = r.newBalance;
          gap = r.remainingNeed;
        } else if (src === "tfsa") {
          const r = withdrawFrom(gap, balances.tfsa, vars.withdrawals.caps.tfsa);
          withdrawals.tfsa += r.withdrawn;
          balances.tfsa = r.newBalance;
          gap = r.remainingNeed;
        }
      }

      // Apply growth at year-end to remaining balances (very simplified)
      balances = {
        fhsa: balances.fhsa * (1 + vars.expectedNominalReturn),
        rrsp: balances.rrsp * (1 + vars.expectedNominalReturn),
        tfsa: balances.tfsa * (1 + vars.expectedNominalReturn),
        lira: balances.lira * (1 + vars.expectedNominalReturn),
        nonRegistered: balances.nonRegistered * (1 + vars.expectedNominalReturn),
      };

      rows.push({
        year,
        ageShingo,
        ageSarah,
        phase,
        targetSpending,
        guaranteedIncome,
        benefitsIncome,
        gap,
        withdrawals,
        endBalances: { ...balances },
      });
    }

    return {
      yearsToRetirement,
      monthsToRetirement,
      baselineTotal,
      monthlyTotal,
      retirementBalances,
      totalNominalAtRetirement,
      totalRealAtRetirement,
      schedule: rows,
    };
  }, [vars, pensionAnnual, baselineTotal, monthlyTotal]);

  const orderOptions: WithdrawalOrder[] = [
    "fhsa",
    "rrsp",
    "lira",
    "nonRegistered",
    "tfsa",
  ];

  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0 }}>RetirementResource</h1>
        <p style={{ marginTop: 8, opacity: 0.85 }}>
          A retirement planning calculator (Canada / BC). Adjust levers (timing,
          contributions, return assumptions, spending phases) while keeping
          anchors explicit.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setVars(DEFAULT_VARIABLES)}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "white",
              cursor: "pointer",
            }}
            title="Reset all inputs back to the starting snapshot and default assumptions"
          >
            Reset to starting values
          </button>
          <div style={{ fontSize: 12, opacity: 0.75, alignSelf: "center" }}>
            Tip: if you’re viewing on Vercel, hard refresh after deploy so the
            newest defaults load.
          </div>
        </div>
      </header>

      <nav
        className="card"
        style={{
          position: "sticky",
          top: 12,
          zIndex: 10,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <strong style={{ marginRight: 8 }}>Jump to:</strong>
        <button type="button" className="linkBtn" onClick={() => scrollTo("expectations")}>Expectations</button>
        <button type="button" className="linkBtn" onClick={() => scrollTo("retirement-balances")}>Balances @ Retirement</button>
        <button type="button" className="linkBtn" onClick={() => scrollTo("withdrawals")}>Withdrawal Schedule</button>
      </nav>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
        <section id="expectations" className="card">
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

        <section id="retirement-balances" className="card">
          <h2>Starting balances at retirement (projected)</h2>
          <ul>
            <li>
              FHSA (household): <strong>${money(model.retirementBalances.fhsa)}</strong>
            </li>
            <li>
              RRSP (household): <strong>${money(model.retirementBalances.rrsp)}</strong>
            </li>
            <li>
              TFSA (household): <strong>${money(model.retirementBalances.tfsa)}</strong>
            </li>
            <li>
              LIRA/LIF (Shingo): <strong>${money(model.retirementBalances.lira)}</strong>
            </li>
            <li>
              Non-registered: <strong>${money(model.retirementBalances.nonRegistered)}</strong>
            </li>
          </ul>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>
              Total (nominal): <strong>${money(model.totalNominalAtRetirement)}</strong>
            </div>
            <div style={{ fontSize: 13 }}>
              Total (in today’s dollars):{" "}
              <strong>${money(model.totalRealAtRetirement)}</strong>
            </div>
          </div>
        </section>

        <section id="withdrawals" className="card">
          <h2>Withdrawal schedule (simple v1)</h2>
          <p style={{ marginTop: 0, opacity: 0.85, fontSize: 13 }}>
            This schedule is <strong>annual</strong> and <strong>pre-tax</strong>.
            Each year we calculate:
            <br />
            <strong>Spending gap to fund</strong> = Target spending − (Pensions + CPP/OAS),
            then withdraw from accounts in your chosen priority order (respecting
            any annual caps).
          </p>

          <div className="grid">
            <Field label="Allow TFSA withdrawals">
              <select
                value={vars.withdrawals.allowTfsa ? "yes" : "no"}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: { ...v.withdrawals, allowTfsa: e.target.value === "yes" },
                  }))
                }
              >
                <option value="no">No (preserve TFSA unless forced)</option>
                <option value="yes">Yes</option>
              </select>
            </Field>

            <Field label="Drawdown priority #1">
              <select
                value={vars.withdrawals.order[0]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => ({
                    ...s,
                    withdrawals: {
                      ...s.withdrawals,
                      order: [v, ...s.withdrawals.order.filter((x) => x !== v)],
                    },
                  }));
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #2">
              <select
                value={vars.withdrawals.order[1]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const rest = s.withdrawals.order.filter((x) => x !== v);
                    const next = [rest[0], v, ...rest.slice(1)].filter(Boolean) as WithdrawalOrder[];
                    // Ensure uniqueness/preserve length
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #3">
              <select
                value={vars.withdrawals.order[2]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], v, ...base.slice(2)];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #4">
              <select
                value={vars.withdrawals.order[3]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], base[2], v, ...base.slice(3)];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Drawdown priority #5">
              <select
                value={vars.withdrawals.order[4]}
                onChange={(e) => {
                  const v = e.target.value as WithdrawalOrder;
                  setVars((s) => {
                    const base = s.withdrawals.order.filter((x) => x !== v);
                    const next = [base[0], base[1], base[2], base[3], v];
                    const unique = Array.from(new Set(next));
                    while (unique.length < 5) {
                      const candidate = orderOptions.find((x) => !unique.includes(x));
                      if (!candidate) break;
                      unique.push(candidate);
                    }
                    return { ...s, withdrawals: { ...s.withdrawals, order: unique } };
                  });
                }}
              >
                {orderOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Withdrawal caps (annual, 0 = no cap)</h3>
          <div className="grid">
            <Field label="FHSA cap">
              <input
                type="number"
                value={vars.withdrawals.caps.fhsa}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, fhsa: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="RRSP/RRIF cap">
              <input
                type="number"
                value={vars.withdrawals.caps.rrsp}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, rrsp: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="LIRA/LIF cap">
              <input
                type="number"
                value={vars.withdrawals.caps.lira}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, lira: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
            <Field label="Non-reg cap">
              <input
                type="number"
                value={vars.withdrawals.caps.nonRegistered}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: {
                        ...v.withdrawals.caps,
                        nonRegistered: num(e.target.value),
                      },
                    },
                  }))
                }
              />
            </Field>
            <Field label="TFSA cap">
              <input
                type="number"
                value={vars.withdrawals.caps.tfsa}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      caps: { ...v.withdrawals.caps, tfsa: num(e.target.value) },
                    },
                  }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Benefits (annual placeholders)</h3>
          <div className="grid">
            <Field label="CPP (Shingo, annual)">
              <input
                type="number"
                value={vars.withdrawals.cppShingoAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      cppShingoAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="CPP (Sarah, annual)">
              <input
                type="number"
                value={vars.withdrawals.cppSarahAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      cppSarahAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="OAS (Shingo, annual)">
              <input
                type="number"
                value={vars.withdrawals.oasShingoAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      oasShingoAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
            <Field label="OAS (Sarah, annual)">
              <input
                type="number"
                value={vars.withdrawals.oasSarahAnnual}
                onChange={(e) =>
                  setVars((v) => ({
                    ...v,
                    withdrawals: {
                      ...v.withdrawals,
                      oasSarahAnnual: num(e.target.value),
                    },
                  }))
                }
              />
            </Field>
          </div>

          <h3 style={{ marginTop: 14 }}>Schedule (first 12 years)</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {[
                    "Year",
                    "Age Shingo",
                    "Age Sarah",
                    "Phase",
                    "Target spending (annual, $)",
                    "Pensions (annual, $)",
                    "CPP/OAS (annual, $)",
                    "Spending gap to fund (annual, $)",
                    "Withdraw: FHSA ($)",
                    "Withdraw: RRSP/RRIF ($)",
                    "Withdraw: LIRA/LIF ($)",
                    "Withdraw: Non-registered ($)",
                    "Withdraw: TFSA ($)",
                    "End balance total (after growth, $)",
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "right",
                        padding: "6px 8px",
                        borderBottom: "1px solid #e5e7eb",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {model.schedule.slice(0, 12).map((r) => {
                  const endTotal =
                    r.endBalances.fhsa +
                    r.endBalances.rrsp +
                    r.endBalances.lira +
                    r.endBalances.tfsa +
                    r.endBalances.nonRegistered;
                  return (
                    <tr key={r.year}>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.year}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.ageShingo}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.ageSarah}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>{r.phase}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.targetSpending)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.guaranteedIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.benefitsIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.targetSpending - r.guaranteedIncome - r.benefitsIncome)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.fhsa)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.rrsp)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.lira)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.nonRegistered)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(r.withdrawals.tfsa)}</td>
                      <td style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #f1f5f9" }}>${money(endTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <footer style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        <div>
          Note: withdrawal schedule is pre-tax and simplified. Next step is to add
          RRIF/LIF rules + tax brackets.
        </div>
      </footer>
    </div>
  );
}
