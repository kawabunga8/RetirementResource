# RetirementResource

A personal retirement planning calculator for Canada / British Columbia. Not financial advice.

## Tech Stack

- **Frontend:** React 19, TypeScript 5.9, Vite 7
- **Backend:** Supabase (PostgreSQL + auth)
- **Testing:** Vitest
- **Linting:** ESLint (strict TypeScript)

## Commands

```bash
npm run dev              # Dev server at localhost:5173
npm test                 # Run Vitest (tax + withdrawal engines)
npm run build            # Type-check + update TFSA rules + Vite bundle
npm run lint             # ESLint
npm run update:public-rules  # Fetch TFSA limits from CRA (runs automatically before build)
```

## Architecture

### Key Concepts

- **Anchors** — Hard facts (birth years, pensions, target retirement year, location)
- **Variables** — Mutable planning parameters (contributions, spending targets, tax inputs)
- **AccountBalances** — FHSA, RRSP, TFSA, LIRA, non-registered balances

### Calculation Layers

1. **Contribution accumulation** (`src/accumulation.ts`) — Projects account growth month by month from today to the end of June of the retirement year. The Overview, the Current tab's snapshot and the withdrawal engine's starting balances and TFSA room all read this ONE schedule — never re-implement the loop in a component
2. **Withdrawal schedule** (`src/withdrawals/engine.ts`) — Simulates annual retirement withdrawals
3. **Household tax** (`src/tax/v2.ts`) — Federal + BC tax, credits, OAS clawback
4. **Public rules** (`src/data/publicRules.ts`) — Auto-generated TFSA/FHSA limits (do not edit by hand)

### Directory Structure

```
src/
├── App.tsx                  # Main app — monolithic component (~3,500 lines)
├── accumulation.ts          # Working-years projection (rows carry start-of-year and end positions)
├── tfsaRoom.ts              # TFSA limit for any year, indexed past the published table
├── planDefaults.ts          # Types + default values for anchors/variables
├── data/publicRules.ts      # Auto-generated TFSA/FHSA limits (via scripts/)
├── lib/
│   ├── supabase.ts          # Supabase client
│   └── db.ts                # load/save plan, members, accounts, benefits
├── tax/
│   ├── tables.ts            # Tax bracket/credit tables by year
│   ├── v2.ts                # Tax calculation engine
│   └── v2.test.ts
└── withdrawals/
    ├── engine.ts            # Retirement withdrawal scheduler
    └── engine.test.ts
scripts/
└── update-public-rules.mjs  # Fetches CRA TFSA page → regenerates publicRules.ts
```

### Database (Supabase)

Credentials are in `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

- `loadPlan()` — Fetches user's plan + members + accounts + benefits
- `savePlan()` — Persists changes
- `loadPublicRules()` — Fetches tax tables, RRIF factors, BC LIF maximums

## Scope

Canada / British Columbia only: federal + BC tax brackets, RRIF factors, BC LIF rules, CPP/OAS modelling.

## Modelling conventions

- **Retirement year is half a year.** Both retire in July (`RETIREMENT_YEAR_FRACTION`). The accumulation saves through June; the engine's first row has half-year pensions, spending, LIF and growth, and its tax is the EXTRA tax on retirement income stacked on six months of salary (`debug.taxOnEmployment` is the salary's own tax).
- **Returns are effective annual rates.** Monthly loops use `(1 + r)^(1/12) - 1`, never `r / 12`.
- **Pension anchors are already starting cheques.** PENCAN's figure is projected to 2036; Sarah's is lifted for raises by `projectedPensionSarah`. `pensionIndexRate*` is COLA only and applies from the retirement year, never from the baseline year.
- **OAS is 10% higher from age 75.**
- **The Tax tab takes retirement-year incomes from the schedule row's `incomeDetail`**, so it taxes exactly what the engine pays.
- **RRSP/RRIF and FHSA are pooled but taxed to their owner.** The engine draws one household pot of each and taxes withdrawals by `ownership` (Shingo's share on retirement day, from the accumulation's per-person balances via `ownershipFromBalances`; re-weighted when the FHSA rolls in). Each row carries the `ownership` it used, and the Tax tab splits by that — never by today's balances or 50/50.
- **OAS repayment is deductible.** `tax/v2.ts` measures the clawback on `totalIncome` (line 23400) and applies the brackets to `taxableIncome` = total less the repayment (line 23500). The engine's `debug.taxableIncome*` and OAS headroom use `totalIncome`.
- **Non-registered income is not taxed as income.** It is approximated by `nonRegTaxDragRate`, a haircut on that account's growth, so it never reaches the yearly tax line or the OAS threshold.

## Notes

- `src/data/publicRules.ts` is auto-generated — changes will be overwritten on next build
- TypeScript is strict: `noUnusedLocals`, `noUnusedParameters` are enforced
- Vitest runs in Node environment (no DOM) — only logic tests, not UI tests
