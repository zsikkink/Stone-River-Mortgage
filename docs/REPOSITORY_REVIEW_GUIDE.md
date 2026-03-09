# Repository Review Guide

This guide is for outside reviewers who want to evaluate architecture and implementation quality quickly.

## What This Project Is

A production-oriented Next.js/TypeScript application for Stone River Mortgage with:

- a public marketing + transaction summary experience
- internal pricing administration
- server-generated PDF output
- county-aware Minnesota property tax retrieval/fallback logic

## Read These Files First

1. `README.md`
2. `docs/ARCHITECTURE.md`
3. `app/api/transaction-summary/route.ts`
4. `lib/propertyTax/calc.ts`
5. `lib/daily-pricing-store.ts`
6. `components/marketing-page.tsx`
7. `components/daily-pricing-page.tsx`

## Key Technical Areas

- **PDF composition** with deterministic loan/tax/title calculations.
- **County strategy/provider architecture** for Minnesota property tax retrieval.
- **Operational persistence model** (KV-first, with safe fallbacks).
- **Production diagnostics** for county TLS/provider failures.

## Run Locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open:

- `/` for the public flow
- `/dailypricing` for admin

## Verification Commands

```bash
npm run typecheck
npm test
npm run build
npm run check:carver-tls
```

## What To Look For

- clear separation between UI, API handlers, and domain logic
- strict validation on API boundaries
- explicit fallback semantics and source provenance in tax results
- maintainable provider isolation by county
