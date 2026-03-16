# Architecture

## System Overview

Stone River Mortgage is a Next.js App Router application with a server-heavy workflow:

- **Public UI** (`/`) for lead generation and transaction summary creation.
- **Internal UI** (`/dailypricing`) for rate/fee management and activity analytics.
- **Server APIs** (`/app/api/*`) for geocoding, property tax retrieval, pricing auth/config, title premium calculations, and PDF generation.

Core business logic is centralized in `lib/` and consumed by API routes.

## Main Execution Flows

### 1) Transaction Summary PDF

1. User opens modal on `MarketingPage` and enters address + loan inputs.
2. Address is selected from autocomplete and verified through server APIs.
3. UI calls `/api/property-tax` for annual tax data and source metadata.
4. UI submits payload to `/api/transaction-summary`.
5. API pulls current Daily Pricing config from `lib/daily-pricing-store.ts`.
6. API computes payment values, APR, title premiums, and closing/funds sections.
7. API renders a single-page PDF via `pdf-lib` and returns `application/pdf`.

Key file: `app/api/transaction-summary/route.ts`.

### 2) Property Tax Retrieval (Minnesota)

The property-tax subsystem is strategy-driven:

- Strategy selection: `lib/propertyTax/strategyRegistry.ts`
- Orchestration + fallback: `lib/propertyTax/calc.ts`
- API shaping: `lib/propertyTax/presentation.ts`
- Provider contracts/types: `lib/propertyTax/types.ts`

### Strategy model

- **Metro counties** route to county providers first (with estimate fallback).
- **Non-metro counties** use county-rate estimation.
- Non-MN requests are rejected by API validation.

### Metro provider model

Providers live under `lib/propertyTax/providers/metro/`.
Each provider is responsible for parcel matching + county-source tax extraction.

### 3) Daily Pricing Admin

Daily Pricing provides sign-in and mutable configuration used by PDF generation.

- API endpoints: `/api/daily-pricing/*`
- Store + auth + analytics: `lib/daily-pricing-store.ts`

Persistence modes (automatic selection):

1. **KV REST** (preferred in production)
2. **Filesystem** (`.data` locally, `/tmp/stone-river-mortgage` in serverless)
3. **In-memory fallback** (last-resort when storage write fails)

The store also records:

- cumulative successful PDF generation count
- successful PDF addresses with first/last PDF timestamps and per-address PDF totals
- derived county performance from each address's first successful PDF tax outcome (`current_year`, `previous_year`, `older_year`, `failed`)
- interest/discount-point change history

Current Daily Pricing analytics are intentionally stored in a separate v2 namespace/key
from the main Daily Pricing store so a new analytics series can start from zero without
overwriting prior production analytics blobs.

## Layering and Boundaries

- `components/*` are client UI and should not contain county/provider parsing logic.
- `app/api/*` handle request validation and response shaping.
- `lib/*` contains deterministic business logic and provider integrations.

This separation keeps UI concerns and county-specific retrieval logic independent.

## Runtime

All API routes are explicitly configured for **Node runtime** (`export const runtime = "nodejs"`) because they depend on:

- Node TLS/HTTPS behavior
- filesystem access for PDF assets
- server-only environment variables

## Testing

Vitest tests cover core financial logic, pricing store behavior, provider parsing/selection, and property tax presentation.

Representative test locations:

- `lib/apr/calc.test.ts`
- `lib/titlePremium/calc.test.ts`
- `lib/daily-pricing-store.test.ts`
- `lib/propertyTax/**/*.test.ts`
