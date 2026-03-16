# Onboarding

This document is the fastest trustworthy path into the Stone River Mortgage repository.
It is written for future engineers and AI agents that need to understand the codebase
quickly without rediscovering structure or operational caveats.

## Read This First

Recommended reading order:

1. [README.md](../README.md)
2. [docs/REPO_MAP.md](REPO_MAP.md)
3. [docs/ARCHITECTURE.md](ARCHITECTURE.md)
4. [docs/PROJECT_STATE.md](PROJECT_STATE.md)
5. [docs/ENVIRONMENT.md](ENVIRONMENT.md)

Then open the core code files for the workflow you care about.

## What This Repo Is

- Single Next.js 15 App Router application
- Public site at `/`
- Internal admin at `/dailypricing`
- Server-side PDF generation
- Minnesota property-tax retrieval/fallback logic
- Daily Pricing persistence and analytics in one store module

Important absences:

- no database
- no migrations
- no Prisma/Drizzle/ORM layer
- no background worker or queue system
- no separate backend service

## First 15 Minutes Reading Path

If you need the shortest possible orientation:

1. [app/page.tsx](../app/page.tsx)
2. [components/marketing-page.tsx](../components/marketing-page.tsx)
3. [app/api/property-tax/route.ts](../app/api/property-tax/route.ts)
4. [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts)
5. [lib/propertyTax/calc.ts](../lib/propertyTax/calc.ts)
6. [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)
7. [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)
8. [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts)

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/dailypricing`

Setup and env details:

- [docs/SETUP.md](SETUP.md)
- [docs/ENVIRONMENT.md](ENVIRONMENT.md)

## Validation Commands

Preferred validation sequence:

```bash
npm test
npm run build
npm run typecheck
```

Or:

```bash
npm run verify
```

Current repo caveats:

- `npm run typecheck` depends on `.next/types`, so it is safest after `npm run build`.
- `npm run lint` is not a reliable validation step in the current repo state because ESLint
  is not fully configured and Next.js will prompt interactively.

## Most Important Files By Topic

Public flow:

- [components/marketing-page.tsx](../components/marketing-page.tsx)
- [components/address-autocomplete.tsx](../components/address-autocomplete.tsx)
- [app/api/geo/autocomplete/route.ts](../app/api/geo/autocomplete/route.ts)
- [app/api/geo/verify-address/route.ts](../app/api/geo/verify-address/route.ts)

Property tax:

- [app/api/property-tax/route.ts](../app/api/property-tax/route.ts)
- [lib/propertyTax/calc.ts](../lib/propertyTax/calc.ts)
- [lib/propertyTax/strategyRegistry.ts](../lib/propertyTax/strategyRegistry.ts)
- `lib/propertyTax/providers/metro/*`

PDF generation:

- [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts)
- [lib/titlePremium/calc.ts](../lib/titlePremium/calc.ts)
- [lib/apr/calc.ts](../lib/apr/calc.ts)

Daily Pricing admin:

- [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)
- [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts)
- [app/api/daily-pricing/login/route.ts](../app/api/daily-pricing/login/route.ts)
- [app/api/daily-pricing/update/route.ts](../app/api/daily-pricing/update/route.ts)
- [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)

Analytics:

- [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)
- [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts)
- [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)

## How To Make Safe Changes

Recommended approach:

1. Start at the route or component entry point.
2. Trace into `lib/` before changing behavior.
3. Check the trusted docs above for persistence and analytics caveats.
4. Keep edits scoped. The repo has several operational edges, and broad refactors create
   unnecessary risk quickly.

Before changing specific areas:

- Daily Pricing persistence:
  verify whether you are touching the main store key or the analytics v2 key
- Analytics:
  confirm whether you are changing successful-PDF tracking or just UI presentation
- Property tax:
  expect county-source volatility and estimation fallback behavior
- PDF generation:
  verify downstream calculations and promo/date constants in the route

## What To Trust

Trust first:

- current code in `app/`, `components/`, and `lib/`
- [README.md](../README.md)
- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/PROJECT_STATE.md](PROJECT_STATE.md)

Use with caution:

- assumptions about production data without live environment access
- county-source stability over time
- `npm run lint` as a CI-quality signal

## Current High-Signal Caveats

- Daily Pricing analytics live in a separate `:analytics:v2` namespace and are intentionally
  not backfilled from legacy analytics.
- Daily Pricing store writes are full-object rewrites, not atomic updates.
- County provider behavior can change outside the repo.
- Carver TLS trust is a recurring operational concern; see `scripts/check-carver-tls.mjs`.
- The Daily Pricing admin still uses a seeded-user authentication model rather than a full
  user/RBAC system.
