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

1. **Contribution accumulation** (App.tsx) — Projects account growth to retirement
2. **Withdrawal schedule** (`src/withdrawals/engine.ts`) — Simulates annual retirement withdrawals
3. **Household tax** (`src/tax/v2.ts`) — Federal + BC tax, credits, OAS clawback
4. **Public rules** (`src/data/publicRules.ts`) — Auto-generated TFSA/FHSA limits (do not edit by hand)

### Directory Structure

```
src/
├── App.tsx                  # Main app — monolithic component (~3,200 lines)
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

## Notes

- `src/data/publicRules.ts` is auto-generated — changes will be overwritten on next build
- TypeScript is strict: `noUnusedLocals`, `noUnusedParameters` are enforced
- Vitest runs in Node environment (no DOM) — only logic tests, not UI tests
