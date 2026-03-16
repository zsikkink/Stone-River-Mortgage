# Architecture

This document describes the current architecture of the Stone River Mortgage repository as
implemented in code today.

Related docs:

- [docs/ONBOARDING.md](ONBOARDING.md)
- [docs/REPO_MAP.md](REPO_MAP.md)
- [docs/PROJECT_STATE.md](PROJECT_STATE.md)

## System Overview

Stone River Mortgage is a single Next.js 15 App Router application with two primary UI
surfaces:

- public marketing and transaction-summary flow at `/`
- internal Daily Pricing admin at `/dailypricing`

The app is server-heavy. API routes perform external API calls, persistence, calculations,
and PDF generation directly inside the Next.js app.

## Important Absences

These are architectural facts, not omissions in this document:

- no database
- no migration framework
- no Prisma/Drizzle/ORM layer
- no worker queue or background job system
- no separate backend service

Operational state is persisted by the Daily Pricing store module.

## Runtime Entry Points

Pages:

- [app/page.tsx](../app/page.tsx)
- [app/dailypricing/page.tsx](../app/dailypricing/page.tsx)

Core UI components:

- [components/marketing-page.tsx](../components/marketing-page.tsx)
- [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)

Core APIs:

- [app/api/geo/autocomplete/route.ts](../app/api/geo/autocomplete/route.ts)
- [app/api/geo/verify-address/route.ts](../app/api/geo/verify-address/route.ts)
- [app/api/property-tax/route.ts](../app/api/property-tax/route.ts)
- [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts)
- [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts)
- [app/api/daily-pricing/login/route.ts](../app/api/daily-pricing/login/route.ts)
- [app/api/daily-pricing/update/route.ts](../app/api/daily-pricing/update/route.ts)
- [app/api/title-premium/route.ts](../app/api/title-premium/route.ts)

## Major Modules

| Area | Primary Files | Responsibility |
| --- | --- | --- |
| Public UI | `components/marketing-page.tsx`, `components/address-autocomplete.tsx` | user-facing loan/PDF flow |
| Daily Pricing UI | `components/daily-pricing-page.tsx` | admin config and activity analytics |
| Daily Pricing persistence/auth | `lib/daily-pricing-store.ts` | pricing store, seeded auth, rate history, analytics |
| Property tax engine | `lib/propertyTax/*` | county strategy selection, provider calls, fallback estimation |
| PDF engine | `app/api/transaction-summary/route.ts` | PDF layout, calculations, analytics write on success |
| Title/APR calculations | `lib/titlePremium/*`, `lib/apr/calc.ts` | deterministic financial math |
| External fetch helpers | `lib/server/fetch-timeout.ts`, `scripts/check-carver-tls.mjs` | timeouts and TLS diagnostics |

## Core Flows

### 1. Address Autocomplete And Verification

1. The public page renders [components/address-autocomplete.tsx](../components/address-autocomplete.tsx).
2. That component calls `/api/geo/autocomplete`.
3. The autocomplete API uses the server-side `GOOGLE_MAPS_API_KEY` and Google Places API
   (New).
4. When the user selects a suggestion, the client calls `/api/geo/verify-address`.
5. The verify route returns normalized address data including Minnesota-only validation,
   county, state, ZIP, latitude, and longitude.

There is no direct client-side Google Maps JS dependency in the current repo flow.

### 2. Property-Tax Retrieval

1. The public flow calls `/api/property-tax`.
2. The route validates Minnesota-only input and delegates to
   [lib/propertyTax/calc.ts](../lib/propertyTax/calc.ts).
3. The property-tax module:
   - normalizes county/state
   - selects a county strategy in
     [lib/propertyTax/strategyRegistry.ts](../lib/propertyTax/strategyRegistry.ts)
   - uses county providers for metro counties when available
   - falls back to county-rate estimation when retrieval is not defensible
4. The route returns:
   - annual tax
   - source labels
   - requested vs actual tax year metadata
   - warnings/details

The property-tax subsystem maintains an in-memory result cache inside the Node process. It
is not a shared distributed cache.

### 3. Transaction Summary PDF Generation

1. The public client calls `/api/transaction-summary` after a successful property-tax
   response.
2. The route:
   - validates payload
   - reads current Daily Pricing config from the store
   - computes monthly payment inputs, APR, title premiums, and funds-to-close sections
   - renders a single-page PDF with `pdf-lib`
3. After `pdfDoc.save()` succeeds, the route records Daily Pricing analytics for the
   successful PDF address.

The PDF route is the source of truth for successful-PDF analytics writes.

### 4. Daily Pricing Admin

Daily Pricing is implemented entirely inside the Next.js app:

- login/logout via cookie-backed session token
- pricing config updates via `/api/daily-pricing/update`
- page data via `/api/daily-pricing`
- optional `/api/daily-pricing/seed` route to force store initialization

The auth model is a seeded-user model rather than a full multi-user identity system.

### 5. Analytics Flow

Active Daily Pricing analytics are defined in
[lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts).

Current behavior:

- only successful PDF generations are tracked
- analytics writes happen on the successful PDF path, not on property-tax lookup
- analytics maintain:
  - cumulative successful PDF count
  - tracked successful-PDF addresses
  - per-address PDF counts and first/last timestamps
  - derived county outcome rates based on the first successful PDF per address
- `/api/daily-pricing` reads analytics and summarizes them for the UI
- `components/daily-pricing-page.tsx` renders the final dashboard view

Important caveat:

- analytics are stored as whole JSON blobs and rewritten on update; there is no append-only
  event log or atomic counter primitive

## Persistence Model

### Main Daily Pricing Store

Code:

- [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)

Default KV key:

- `stone-river-mortgage:daily-pricing:v1`

Filesystem fallback:

- local: `.data/daily-pricing.json`
- serverless/prod fallback: `/tmp/stone-river-mortgage/daily-pricing.json`

Contents:

- seeded users
- sessions
- pricing config
- pricing rate history
- legacy embedded analytics fields retained for compatibility

### Current Analytics Series

Default KV key:

- `stone-river-mortgage:daily-pricing:v1:analytics:v2`

Filesystem fallback:

- local: `.data/daily-pricing-analytics-v2.json`
- serverless/prod fallback: `/tmp/stone-river-mortgage/daily-pricing-analytics-v2.json`

Why it exists separately:

- the v2 analytics series starts fresh without deleting or mutating legacy analytics blobs
- it avoids destructive resets of older production data

### Write Semantics

Current write behavior is important:

- main store writes are whole-object rewrites
- analytics writes are whole-object rewrites
- there are no partial KV field updates
- there are no atomic counters

This is adequate for current product behavior but should be treated carefully for any
future audit-grade metrics work.

## External Integrations

Google:

- Places autocomplete
- Place details / address verification

County systems:

- metro county provider sources under `lib/propertyTax/providers/metro`
- external provider behavior can change over time

Vercel / KV:

- production deployment target is Vercel
- KV REST is the preferred persistence backend for shared state

## Runtime And Deployment Notes

All API routes explicitly use the Node runtime because they depend on:

- Node TLS behavior
- filesystem access
- server-only environment variables
- `pdf-lib` server rendering

## Testing

The repo uses Vitest for unit/integration-style tests around domain logic and diagnostics.

High-value tests:

- [lib/daily-pricing-store.test.ts](../lib/daily-pricing-store.test.ts)
- [lib/propertyTax/calc.test.ts](../lib/propertyTax/calc.test.ts)
- [lib/propertyTax/strategyRegistry.test.ts](../lib/propertyTax/strategyRegistry.test.ts)
- [lib/titlePremium/calc.test.ts](../lib/titlePremium/calc.test.ts)
- [lib/apr/calc.test.ts](../lib/apr/calc.test.ts)
- [scripts/check-carver-tls.test.mjs](../scripts/check-carver-tls.test.mjs)

There is no browser E2E test suite in the current repo state.
