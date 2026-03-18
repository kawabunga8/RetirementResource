import { supabase } from "./supabase";
import type { Anchors, Variables } from "../planDefaults";
import type { TaxYearTables } from "../tax/tables";

// ─── Types mirroring DB rows ──────────────────────────────────────────────────

type DbPlan = {
  id: string;
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
  varsOverrides: Partial<Variables>;
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
  const accounts = (accountsRes.data ?? []) as DbAccount[];
  const phases = (phasesRes.data ?? []) as DbSpendingPhase[];
  const benefits = (benefitsRes.data ?? []) as DbBenefit[];

  const shingo = members.find((m) => m.name === "Shingo");
  const sarah = members.find((m) => m.name === "Sarah");
  if (!shingo || !sarah) return null;

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

  const varsOverrides: Partial<Variables> = {
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
      cppShingoAnnual: benefit(shingo.id, "cpp")?.annual_amount ?? 0,
      cppSarahAnnual: benefit(sarah.id, "cpp")?.annual_amount ?? 0,
      oasShingoAnnual: benefit(shingo.id, "oas")?.annual_amount ?? 0,
      oasSarahAnnual: benefit(sarah.id, "oas")?.annual_amount ?? 0,
    } as Variables["withdrawals"],
  };

  return { planId: plan.id, anchors, varsOverrides };
}

// ─── Save plan ────────────────────────────────────────────────────────────────

export async function savePlan(
  planId: string,
  anchors: Anchors,
  vars: Variables
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  // Fetch member IDs
  const { data: members } = await supabase
    .from("plan_members")
    .select("id, name")
    .eq("plan_id", planId);

  const shingo = members?.find((m) => m.name === "Shingo");
  const sarah = members?.find((m) => m.name === "Sarah");
  if (!shingo || !sarah) return;

  await Promise.all([
    // Plan top-level
    supabase.from("plans").update({
      target_retirement_year: anchors.targetRetirementYear,
      baseline_year: anchors.baselineYear,
      location: anchors.location,
      balances_as_of: vars.balancesAsOf ?? null,
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
      { plan_id: planId, member_id: shingo.id, account_type: "fhsa",           balance: vars.balances.fhsaShingo,    contribution_room: 0,                    monthly_contribution: vars.monthly.fhsaShingo },
      { plan_id: planId, member_id: sarah.id,  account_type: "fhsa",           balance: vars.balances.fhsaSarah,     contribution_room: 0,                    monthly_contribution: vars.monthly.fhsaSarah },
      { plan_id: planId, member_id: shingo.id, account_type: "rrsp",           balance: vars.balances.rrspShingo,    contribution_room: vars.rrspRoomShingo,   monthly_contribution: vars.monthly.rrspShingo },
      { plan_id: planId, member_id: sarah.id,  account_type: "rrsp",           balance: vars.balances.rrspSarah,     contribution_room: vars.rrspRoomSarah,    monthly_contribution: vars.monthly.rrspSarah },
      { plan_id: planId, member_id: shingo.id, account_type: "tfsa",           balance: vars.balances.tfsaShingo,    contribution_room: vars.tfsaRoomShingo,   monthly_contribution: 0 },
      { plan_id: planId, member_id: sarah.id,  account_type: "tfsa",           balance: vars.balances.tfsaSarah,     contribution_room: vars.tfsaRoomSarah,    monthly_contribution: 0 },
      { plan_id: planId, member_id: shingo.id, account_type: "lira",           balance: vars.balances.liraShingo,    contribution_room: 0,                    monthly_contribution: 0 },
      { plan_id: planId, member_id: null,      account_type: "non_registered", balance: vars.balances.nonRegistered, contribution_room: 0,                    monthly_contribution: 0 },
    ], { onConflict: "plan_id,member_id,account_type" }),
  ]);
}

// ─── Load public rules ────────────────────────────────────────────────────────

export type PublicRules = {
  tfsaLimitsByYear: Record<string, number>;
  taxTables: TaxYearTables[];
  rrifFactors: Record<number, number>;
  bcLifMax: Record<number, number>;
};

export async function loadPublicRules(): Promise<PublicRules | null> {
  const [tfsaRes, bracketsRes, creditsRes, rrifRes, lifRes] = await Promise.all([
    supabase.from("public_rules_tfsa_limits").select("year, annual_limit").order("year"),
    supabase.from("public_rules_tax_brackets").select("*").order("tax_year").order("sort_order"),
    supabase.from("public_rules_tax_credits").select("*"),
    supabase.from("public_rules_rrif_factors").select("age, factor").order("age"),
    supabase.from("public_rules_bc_lif_max").select("age, max_pct").order("age"),
  ]);

  if (tfsaRes.error || bracketsRes.error || creditsRes.error || rrifRes.error || lifRes.error) {
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

  // Tax tables — group brackets + credits by year
  const years = [...new Set((bracketsRes.data ?? []).map((r: any) => r.tax_year))];
  const taxTables: TaxYearTables[] = years.map((year) => {
    const fedBrackets = (bracketsRes.data ?? [])
      .filter((r: any) => r.tax_year === year && r.jurisdiction === "federal")
      .map((r: any) => ({ upTo: r.up_to === null ? Infinity : Number(r.up_to), rate: Number(r.rate) }));

    const bcBrackets = (bracketsRes.data ?? [])
      .filter((r: any) => r.tax_year === year && r.jurisdiction === "bc")
      .map((r: any) => ({ upTo: r.up_to === null ? Infinity : Number(r.up_to), rate: Number(r.rate) }));

    const fedCredits = (creditsRes.data ?? []).find((r: any) => r.tax_year === year && r.jurisdiction === "federal");
    const bcCredits  = (creditsRes.data ?? []).find((r: any) => r.tax_year === year && r.jurisdiction === "bc");

    return {
      year: Number(year),
      federal: {
        brackets: fedBrackets,
        lowestRate: fedBrackets[0]?.rate ?? 0.15,
        bpa: Number(fedCredits?.bpa ?? 0),
        ageAmountMax: Number(fedCredits?.age_amount_max ?? 0),
        ageAmountThreshold: Number(fedCredits?.age_amount_threshold ?? 0),
        ageAmountPhaseOutRate: Number(fedCredits?.age_amount_phase_out ?? 0),
        pensionCreditBase: Number(fedCredits?.pension_credit_base ?? 0),
        oasClawbackThreshold: Number(fedCredits?.oas_clawback_threshold ?? 91000),
        oasClawbackRate: Number(fedCredits?.oas_clawback_rate ?? 0.15),
      },
      bc: {
        brackets: bcBrackets,
        lowestRate: bcBrackets[0]?.rate ?? 0.0506,
        bpa: Number(bcCredits?.bpa ?? 0),
        ageAmountMax: Number(bcCredits?.age_amount_max ?? 0),
        ageAmountThreshold: Number(bcCredits?.age_amount_threshold ?? 0),
        ageAmountPhaseOutRate: Number(bcCredits?.age_amount_phase_out ?? 0),
        pensionCreditBase: Number(bcCredits?.pension_credit_base ?? 0),
      },
    };
  });

  return { tfsaLimitsByYear, taxTables, rrifFactors, bcLifMax };
}
