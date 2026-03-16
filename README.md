# Stone River Mortgage

Stone River Mortgage is a Next.js 15 App Router application that combines:

- a public marketing page at `/`
- a server-generated Minnesota transaction summary PDF flow
- an internal Daily Pricing admin at `/dailypricing`

This repository is a single-app codebase. There is no separate backend service, no ORM,
no SQL schema, no migration system, and no worker/queue layer. Operational state lives in
the Daily Pricing store, which persists to KV REST when configured and falls back to the
filesystem or in-memory storage.

## What The App Does

Primary workflows:

1. Address autocomplete and verification through Google Places server APIs.
2. Minnesota property-tax retrieval with county-provider strategies and estimate fallback.
3. Server-side transaction summary PDF generation with pricing, tax, title, and APR logic.
4. Daily Pricing auth, pricing configuration, rate history, and successful-PDF activity
   analytics.

## Quick Start

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open:

- `http://localhost:3000/`
- `http://localhost:3000/dailypricing`

Required local env vars:

- `GOOGLE_MAPS_API_KEY`
- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

Full setup details: [docs/SETUP.md](docs/SETUP.md)

## Validation Commands

```bash
npm test
npm run build
npm run typecheck
```

Use `npm run verify` for the same sequence.

Important repo caveat:

- `tsconfig.json` includes `.next/types/**/*.ts`, so `npm run typecheck` is most reliable
  after `npm run build` has generated fresh Next.js types.
- `npm run lint` is present in `package.json`, but ESLint is not fully configured in the
  current repo state. Running it will trigger Next.js setup prompts instead of acting as a
  stable validation step.

## Where To Start Reading

If you are new to the repo, use this order:

1. [docs/ONBOARDING.md](docs/ONBOARDING.md)
2. [docs/REPO_MAP.md](docs/REPO_MAP.md)
3. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
4. [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)
5. [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)

## Important Entry Points

- Public page: [app/page.tsx](app/page.tsx)
- Daily Pricing page: [app/dailypricing/page.tsx](app/dailypricing/page.tsx)
- Public UI: [components/marketing-page.tsx](components/marketing-page.tsx)
- Daily Pricing UI: [components/daily-pricing-page.tsx](components/daily-pricing-page.tsx)
- PDF route: [app/api/transaction-summary/route.ts](app/api/transaction-summary/route.ts)
- Property-tax route: [app/api/property-tax/route.ts](app/api/property-tax/route.ts)
- Daily Pricing store: [lib/daily-pricing-store.ts](lib/daily-pricing-store.ts)

## Project Structure

High-signal directories:

- `app/`: route entry points and API handlers
- `components/`: client-side UI for marketing, Daily Pricing, and utilities
- `lib/`: business logic, calculations, persistence, and property-tax providers
- `docs/`: trusted documentation for onboarding, architecture, and operations
- `scripts/`: local operational helpers and Carver TLS diagnostics
- `public/`: brand assets and PDF preview font assets

Detailed map: [docs/REPO_MAP.md](docs/REPO_MAP.md)

## Architecture And Operations

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Environment variables: [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)
- Deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Current status / fragility / likely next work: [docs/PROJECT_STATE.md](docs/PROJECT_STATE.md)
- Known operational limitations: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)
- Contributing constraints: [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)

## Key Technical Realities

- The app is Minnesota-specific for transaction summary workflows.
- Property-tax retrieval depends on external county systems and can fall back to estimates.
- Daily Pricing analytics now track successful PDF addresses only, using a separate v2
  analytics namespace.
- Daily Pricing persistence uses whole-object rewrites, not atomic field updates.
- Production deployment target is Vercel.

## Ownership

Copyright (c) Zack Sikkink.

This repository is proprietary and not licensed for public use, copying, modification,
distribution, sublicensing, or sale without prior written permission. See
[LICENSE](LICENSE).
