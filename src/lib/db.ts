import { supabase } from "./supabase";
import type { Anchors, Variables } from "../planDefaults";

// ─── Types mirroring DB rows ──────────────────────────────────────────────────

type DbPlan = {
  id: string;
  settings?: Partial<Variables> | null;
  baseline_year: number;
  target_retirement_year: number;
  location: string;
  balances_as_of: string | null;
};

type DbMember = {
  id: string;
  name: string;
  birth_year: number;
  retire_age: number;
  cpp_start_age: number;
  oas_start_age: number;
  pension_annual: number;
};

type DbAssumptions = {
  expected_nominal_return: number;
  expected_inflation: number;
  cpi_multiplier: number;
};

type DbAccount = {
  member_id: string | null;
  account_type: string;
  balance: number;
  contribution_room: number;
  monthly_contribution: number;
  as_of_date: string;
};

type DbSpendingPhase = {
  phase: string;
  to_age: number;
  annual_amount: number;
};

type DbBenefit = {
  member_id: string;
  benefit_type: string;
  annual_amount: number;
};

// ─── Load plan ────────────────────────────────────────────────────────────────

export type LoadedPlan = {
  planId: string;
  anchors: Anchors;
  varsOverrides: PlanVarsOverrides;
};

export async function loadPlan(): Promise<LoadedPlan | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: plans, error } = await supabase
    .from("plans")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !plans?.length) return null;
  const plan = plans[0] as DbPlan;

  const [membersRes, assumptionsRes, accountsRes, phasesRes, benefitsRes] = await Promise.all([
    supabase.from("plan_members").select("*").eq("plan_id", plan.id),
    supabase.from("plan_assumptions").select("*").eq("plan_id", plan.id).limit(1),
    supabase.from("plan_accounts").select("*").eq("plan_id", plan.id),
    supabase.from("plan_spending_phases").select("*").eq("plan_id", plan.id),
    supabase.from("plan_benefits").select("*"),
  ]);

  const members = (membersRes.data ?? []) as DbMember[];
  const assumptions = (assumptionsRes.data?.[0] ?? null) as DbAssumptions | null;
  const allAccounts = (accountsRes.data ?? []) as DbAccount[];
  const phases = (phasesRes.data ?? []) as DbSpendingPhase[];

  const shingo = members.find((m) => m.name === "Shingo");
  const sarah = members.find((m) => m.name === "Sarah");
  if (!shingo || !sarah) return null;

    const toDateString = (d: string | Date | null | undefined): string => {
    if (!d) return "";
    if (typeof d === "string") return d;
    return new Date(d).toISOString().split('T')[0];
  };

  const asOfDateStr = toDateString(plan.balances_as_of);

  let accounts = allAccounts.filter((a) => toDateString(a.as_of_date) === asOfDateStr);

  // Fallback: if nothing matches the plan's as-of date, use the most recent
  // snapshot date present in the account rows.
  if (accounts.length === 0 && allAccounts.length > 0) {
    const uniqueDates = allAccounts
      .map(a => toDateString(a.as_of_date))
      .filter(d => d !== "");
    const mostRecentDate = [...new Set(uniqueDates)].sort().reverse()[0];
    accounts = allAccounts.filter((a) => toDateString(a.as_of_date) === mostRecentDate);
  }

  // plan_benefits has no plan_id column, only member_id — scope to this plan's members
  // to avoid pulling another plan's benefit rows if member IDs were ever non-unique.
  const memberIds = new Set(members.map((m) => m.id));
  const benefits = ((benefitsRes.data ?? []) as DbBenefit[]).filter((b) => memberIds.has(b.member_id));

  const account = (type: string, memberId?: string) =>
    accounts.find((a) => a.account_type === type && (memberId ? a.member_id === memberId : true));

  const benefit = (memberId: string, type: string) =>
    benefits.find((b) => b.member_id === memberId && b.benefit_type === type);

  const anchors: Anchors = {
    location: plan.location,
    targetRetirementYear: plan.target_retirement_year,
    baselineYear: plan.baseline_year,
    shingoBirthYear: shingo.birth_year,
    sarahBirthYear: sarah.birth_year,
    pensionShingo: shingo.pension_annual,
    pensionSarah: sarah.pension_annual,
    cppShingoAt70Monthly: (benefit(shingo.id, "cpp")?.annual_amount ?? 0) / 12,
  };

  // Settings stored as a JSON blob. Applied FIRST so the normalised columns
  // below always win -- they are the authoritative copy for anything that has
  // a real column.
  const settings = (plan.settings ?? {}) as Partial<Variables>;

  const varsOverrides: PlanVarsOverrides = {
    ...settings,
    ...(settings.withdrawals ? { withdrawals: { ...settings.withdrawals } } : {}),
    retirementYear: plan.target_retirement_year,
    shingoRetireAge: shingo.retire_age,
    sarahRetireAge: sarah.retire_age,
    cppStartAge: shingo.cpp_start_age,
    oasStartAge: shingo.oas_start_age,
    ...(assumptions && {
      expectedNominalReturn: assumptions.expected_nominal_return,
      expectedInflation: assumptions.expected_inflation,
      cpiMultiplier: assumptions.cpi_multiplier,
    }),
    balances: {
      fhsaShingo: account("fhsa", shingo.id)?.balance ?? 0,
      fhsaSarah: account("fhsa", sarah.id)?.balance ?? 0,
      rrspShingo: account("rrsp", shingo.id)?.balance ?? 0,
      rrspSarah: account("rrsp", sarah.id)?.balance ?? 0,
      tfsaShingo: account("tfsa", shingo.id)?.balance ?? 0,
      tfsaSarah: account("tfsa", sarah.id)?.balance ?? 0,
      liraShingo: account("lira", shingo.id)?.balance ?? 0,
      nonRegistered: account("non_registered")?.balance ?? 0,
    },
    balancesAsOf: plan.balances_as_of ?? "2026-01-01",
    tfsaRoomShingo: account("tfsa", shingo.id)?.contribution_room ?? 0,
    tfsaRoomSarah: account("tfsa", sarah.id)?.contribution_room ?? 0,
    rrspRoomShingo: account("rrsp", shingo.id)?.contribution_room ?? 0,
    rrspRoomSarah: account("rrsp", sarah.id)?.contribution_room ?? 0,
    monthly: {
      tfsaTotal: (account("tfsa", shingo.id)?.monthly_contribution ?? 0) + (account("tfsa", sarah.id)?.monthly_contribution ?? 0),
      fhsaShingo: account("fhsa", shingo.id)?.monthly_contribution ?? 0,
      fhsaSarah: account("fhsa", sarah.id)?.monthly_contribution ?? 0,
      rrspShingo: account("rrsp", shingo.id)?.monthly_contribution ?? 0,
      rrspSarah: account("rrsp", sarah.id)?.monthly_contribution ?? 0,
    },
    spending: {
      goGo: phases.find((p) => p.phase === "go_go")?.annual_amount ?? 100000,
      slowGo: phases.find((p) => p.phase === "slow_go")?.annual_amount ?? 90000,
      noGo: phases.find((p) => p.phase === "no_go")?.annual_amount ?? 75000,
    },
    withdrawals: {
      ...(settings.withdrawals ?? {}),
      cppShingoAnnual: benefit(shingo.id, "cpp")?.annual_amount ?? 0,
      cppSarahAnnual: benefit(sarah.id, "cpp")?.annual_amount ?? 0,
      oasShingoAnnual: benefit(shingo.id, "oas")?.annual_amount ?? 0,
      oasSarahAnnual: benefit(sarah.id, "oas")?.annual_amount ?? 0,
    },
  };

  return { planId: plan.id, anchors, varsOverrides };
}

// ─── Save plan ────────────────────────────────────────────────────────────────

/** What went wrong during a save, if anything. Empty array means all good. */
export type SaveError = { what: string; message: string };

/**
 * Persist the plan.
 *
 * Every statement's error is checked and returned. The Supabase client resolves
 * with `{ data, error }` rather than throwing, so a failing statement inside a
 * Promise.all is invisible unless someone looks -- and nobody did. That is how
 * account balances silently stopped saving while the plan's balances_as_of date
 * kept advancing: the upsert was failing and the plain update next to it was
 * not.
 */
export async function savePlan(
  planId: string,
  anchors: Anchors,
  vars: Variables
): Promise<SaveError[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return [{ what: "auth", message: "no user logged in" }];
  }

  // Fetch member IDs
  const { data: members } = await supabase
    .from("plan_members")
    .select("id, name")
    .eq("plan_id", planId);

  const shingo = members?.find((m) => m.name === "Shingo");
  const sarah = members?.find((m) => m.name === "Sarah");
  if (!shingo || !sarah) {
    return [{ what: "plan_members", message: "members not found for this plan" }];
  }

  const labels = ["plans", "plan_members (Shingo)", "plan_members (Sarah)",
                  "plan_assumptions", "plan_spending_phases", "plan_benefits",
                  "plan_accounts"];

  const results = await Promise.all([
    // Plan top-level
    supabase.from("plans").update({
      target_retirement_year: anchors.targetRetirementYear,
      baseline_year: anchors.baselineYear,
      location: anchors.location,
      balances_as_of: vars.balancesAsOf ?? null,
      // Everything without a column of its own. Pension adjustments, earned
      // income, per-person indexation, FHSA inputs, phase ages, tax toggles and
      // the whole withdrawal strategy used to exist only in code defaults and
      // browser localStorage -- so they never followed the user to another
      // device, and a code change to a default could be silently overridden or
      // silently ignored depending on which it was.
      settings: settingsBlobFrom(vars),
    }).eq("id", planId),

    // Members
    supabase.from("plan_members").update({
      birth_year: anchors.shingoBirthYear,
      retire_age: vars.shingoRetireAge,
      cpp_start_age: vars.cppStartAge,
      oas_start_age: vars.oasStartAge,
      pension_annual: anchors.pensionShingo,
    }).eq("id", shingo.id),

    supabase.from("plan_members").update({
      birth_year: anchors.sarahBirthYear,
      retire_age: vars.sarahRetireAge,
      pension_annual: anchors.pensionSarah,
    }).eq("id", sarah.id),

    // Assumptions
    supabase.from("plan_assumptions").update({
      expected_nominal_return: vars.expectedNominalReturn,
      expected_inflation: vars.expectedInflation,
      cpi_multiplier: vars.cpiMultiplier,
    }).eq("plan_id", planId),

    // Spending phases
    supabase.from("plan_spending_phases").upsert([
      { plan_id: planId, phase: "go_go",   to_age: vars.phaseAges.goGoEndAge,   annual_amount: vars.spending.goGo },
      { plan_id: planId, phase: "slow_go", to_age: vars.phaseAges.slowGoEndAge, annual_amount: vars.spending.slowGo },
      { plan_id: planId, phase: "no_go",   to_age: vars.phaseAges.endAge,       annual_amount: vars.spending.noGo },
    ], { onConflict: "plan_id,phase" }),

    // Benefits
    supabase.from("plan_benefits").upsert([
      { member_id: shingo.id, benefit_type: "cpp", annual_amount: vars.withdrawals.cppShingoAnnual },
      { member_id: sarah.id,  benefit_type: "cpp", annual_amount: vars.withdrawals.cppSarahAnnual },
      { member_id: shingo.id, benefit_type: "oas", annual_amount: vars.withdrawals.oasShingoAnnual },
      { member_id: sarah.id,  benefit_type: "oas", annual_amount: vars.withdrawals.oasSarahAnnual },
    ], { onConflict: "member_id,benefit_type" }),

    // Accounts
    supabase.from("plan_accounts").upsert([
      { plan_id: planId, member_id: shingo.id, account_type: "fhsa",           balance: vars.balances.fhsaShingo,    contribution_room: 0,                    monthly_contribution: vars.monthly.fhsaShingo, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: sarah.id,  account_type: "fhsa",           balance: vars.balances.fhsaSarah,     contribution_room: 0,                    monthly_contribution: vars.monthly.fhsaSarah, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: shingo.id, account_type: "rrsp",           balance: vars.balances.rrspShingo,    contribution_room: vars.rrspRoomShingo,   monthly_contribution: vars.monthly.rrspShingo, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: sarah.id,  account_type: "rrsp",           balance: vars.balances.rrspSarah,     contribution_room: vars.rrspRoomSarah,    monthly_contribution: vars.monthly.rrspSarah, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: shingo.id, account_type: "tfsa",           balance: vars.balances.tfsaShingo,    contribution_room: vars.tfsaRoomShingo,   monthly_contribution: (vars.monthly.tfsaTotal ?? 0) / 2, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: sarah.id,  account_type: "tfsa",           balance: vars.balances.tfsaSarah,     contribution_room: vars.tfsaRoomSarah,    monthly_contribution: (vars.monthly.tfsaTotal ?? 0) / 2, as_of_date: vars.balancesAsOf },
      { plan_id: planId, member_id: shingo.id, account_type: "lira",           balance: vars.balances.liraShingo,    contribution_room: 0,                    monthly_contribution: 0, as_of_date: vars.balancesAsOf },
    ], { onConflict: "plan_id,member_id,account_type" }),
  ]);

  const errors: SaveError[] = [];
  results.forEach((r, i) => {
    const err = (r as { error?: { message?: string } | null })?.error;
    if (err) errors.push({ what: labels[i] ?? `statement ${i}`, message: err.message ?? String(err) });
  });

  // The non-registered account is handled separately and deliberately.
  //
  // Its member_id is NULL, and Postgres treats NULLs as DISTINCT in a unique
  // constraint -- so `ON CONFLICT (plan_id, member_id, account_type)` never
  // matched it and every save inserted another row. loadPlan then picked
  // whichever duplicate came back first, which is why the balance could differ
  // from what was last entered.
  //
  // Update the existing row by primary key if there is one; insert only if not.
  const { data: existingNonReg } = await supabase
    .from("plan_accounts")
    .select("id")
    .eq("plan_id", planId)
    .is("member_id", null)
    .eq("account_type", "non_registered")
    .order("as_of_date", { ascending: false })
    .limit(1);

  const nonRegRow = {
    plan_id: planId,
    member_id: null,
    account_type: "non_registered",
    balance: vars.balances.nonRegistered,
    contribution_room: 0,
    monthly_contribution: 0,
    as_of_date: vars.balancesAsOf,
  };

  const nonRegRes = existingNonReg?.length
    ? await supabase.from("plan_accounts").update(nonRegRow).eq("id", existingNonReg[0].id)
    : await supabase.from("plan_accounts").insert(nonRegRow);

  if (nonRegRes.error) {
    errors.push({ what: "plan_accounts (non-registered)", message: nonRegRes.error.message });
  }

  if (errors.length) {
    console.error("savePlan failed:", errors);
  }
  return errors;
}

// ─── Load public rules ────────────────────────────────────────────────────────

/**
 * What a saved plan overrides. `withdrawals` is a DEEP partial: the database
 * supplies only the CPP/OAS amounts, and every other withdrawal setting must
 * fall through to the defaults.
 *
 * This used to be `Partial<Variables>`, which types `withdrawals` as the FULL
 * object when present -- so the loader cast four fields with
 * `as Variables["withdrawals"]` and claimed they were all of them. Harmless
 * only because App.tsx happens to merge field-by-field; anyone writing the
 * natural `...ov` would silently blank rrifDepleteByAge, lifMode and the rest
 * with no type error.
 */
export type PlanVarsOverrides = Partial<Omit<Variables, "withdrawals">> & {
  withdrawals?: Partial<Variables["withdrawals"]>;
};

/**
 * Settings that live in normalised columns and tables, and must therefore NOT
 * be duplicated into plans.settings. Writing them in both places invites the
 * two copies to disagree, which is the failure this whole mechanism exists to
 * prevent.
 */
const NORMALISED_KEYS = [
  "retirementYear", "shingoRetireAge", "sarahRetireAge", "cppStartAge", "oasStartAge",
  "expectedNominalReturn", "expectedInflation", "cpiMultiplier",
  "balances", "balancesAsOf",
  "tfsaRoomShingo", "tfsaRoomSarah", "rrspRoomShingo", "rrspRoomSarah",
  "monthly", "spending",
] as const;

/** Everything else -- the settings the database had no home for until now. */
function settingsBlobFrom(vars: Variables): Record<string, unknown> {
  const out: Record<string, unknown> = { ...vars };
  for (const k of NORMALISED_KEYS) delete out[k];
  // CPP/OAS amounts live in plan_benefits; the rest of `withdrawals` does not.
  const w = { ...vars.withdrawals } as Record<string, unknown>;
  delete w.cppShingoAnnual; delete w.cppSarahAnnual;
  delete w.oasShingoAnnual; delete w.oasSarahAnnual;
  out.withdrawals = w;
  return out;
}

export type PublicRules = {
  tfsaLimitsByYear: Record<string, number>;
  rrifFactors: Record<number, number>;
  bcLifMax: Record<number, number>;
};

export async function loadPublicRules(): Promise<PublicRules | null> {
  // NOTE: tax brackets and credits are deliberately NOT loaded from the
  // database. They live in src/tax/tables.ts, under version control, where a
  // change gets reviewed. The public_rules_tax_brackets / _tax_credits tables
  // were a hand-maintained duplicate that silently drifted to 2024 values and
  // overrode the correct built-in figures for months. The tables are left in
  // place but no longer read.
  const [tfsaRes, rrifRes, lifRes] = await Promise.all([
    supabase.from("public_rules_tfsa_limits").select("year, annual_limit").order("year"),
    supabase.from("public_rules_rrif_factors").select("age, factor").order("age"),
    supabase.from("public_rules_bc_lif_max").select("age, max_pct").order("age"),
  ]);

  if (tfsaRes.error || rrifRes.error || lifRes.error) {
    return null;
  }

  // TFSA limits
  const tfsaLimitsByYear: Record<string, number> = {};
  for (const row of tfsaRes.data ?? []) {
    tfsaLimitsByYear[String(row.year)] = Number(row.annual_limit);
  }

  // RRIF factors
  const rrifFactors: Record<number, number> = {};
  for (const row of rrifRes.data ?? []) {
    rrifFactors[row.age] = Number(row.factor);
  }

  // BC LIF max
  const bcLifMax: Record<number, number> = {};
  for (const row of lifRes.data ?? []) {
    bcLifMax[row.age] = Number(row.max_pct);
  }

  return { tfsaLimitsByYear, rrifFactors, bcLifMax };
}
