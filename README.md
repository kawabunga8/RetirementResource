# RetirementResource

A retirement planning **calculator** that allows manipulation of key variables (timing, contributions, return assumptions, spending phases, withdrawals) while keeping “anchors” (hard facts / slow-moving assumptions) explicit.

**Current focus:** Canada / British Columbia.

## What this is (intent)

This repo is for an *interactive calculator* to explore:
- Retirement start ages (primary + alternates)
- CPP/OAS start ages
- Contribution levels (RRSP / TFSA / FHSA redirection)
- Nominal return assumptions (stress tests)
- Phase-based spending targets (Go-Go / Slow-Go / No-Go)
- Withdrawal strategy (RRSP→RRIF drawdown, LIRA→LIF min/max)
- Taxes (eventually): brackets, credits, splitting, clawbacks

## What this is not

- Not financial advice.
- Not a brokerage/trading tool.

## Development

```bash
npm install
npm run dev
```

## Deploy (Vercel)

This is a Vite React app. In Vercel, import the repo and deploy with the default Vite settings.

## Roadmap (next)

- Model starting balances + monthly contributions with growth
- Phase transitions (Go-Go / Slow-Go / No-Go) with real spending targets
- CPP/OAS approximations and indexation toggles
- RRIF/LIF withdrawal rules (BC)
- Basic tax modeling (federal + BC)
- Export scenarios to JSON and compare side-by-side
