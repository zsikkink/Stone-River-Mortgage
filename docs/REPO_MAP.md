# Repo Map

This map is meant to answer the practical onboarding questions quickly:

- Where does the app start?
- Where are the important APIs?
- Where is PDF generation?
- Where are analytics defined?
- Is there a database or worker system?

## Top-Level Directories

| Path | Purpose | Start Here For |
| --- | --- | --- |
| `app/` | Next.js pages, layouts, and API route entry points | request entry points and route-level behavior |
| `components/` | Client UI components | public UX and Daily Pricing UI |
| `lib/` | Domain logic, calculations, persistence, provider integrations | business rules and shared logic |
| `docs/` | Trusted project and operational documentation | onboarding and current-state context |
| `scripts/` | Local operational helpers and diagnostics | Carver TLS troubleshooting and dev hygiene |
| `public/` | Static assets | logos, PDF preview assets, standard fonts |

## Key Entry Points

Public app:

- [app/page.tsx](../app/page.tsx) -> [components/marketing-page.tsx](../components/marketing-page.tsx)

Daily Pricing:

- [app/dailypricing/page.tsx](../app/dailypricing/page.tsx) -> [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)

Shared app shell:

- [app/layout.tsx](../app/layout.tsx)
- [app/globals.css](../app/globals.css)

## API Routes

| Route | File | Responsibility |
| --- | --- | --- |
| `/api/geo/autocomplete` | [app/api/geo/autocomplete/route.ts](../app/api/geo/autocomplete/route.ts) | Google Places autocomplete proxy |
| `/api/geo/verify-address` | [app/api/geo/verify-address/route.ts](../app/api/geo/verify-address/route.ts) | verified Minnesota address details |
| `/api/property-tax` | [app/api/property-tax/route.ts](../app/api/property-tax/route.ts) | property-tax lookup and estimate fallback response |
| `/api/transaction-summary` | [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts) | PDF generation |
| `/api/title-premium` | [app/api/title-premium/route.ts](../app/api/title-premium/route.ts) | title premium + APR calculator API |
| `/api/daily-pricing` | [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts) | Daily Pricing page payload including analytics |
| `/api/daily-pricing/login` | [app/api/daily-pricing/login/route.ts](../app/api/daily-pricing/login/route.ts) | admin sign-in |
| `/api/daily-pricing/logout` | [app/api/daily-pricing/logout/route.ts](../app/api/daily-pricing/logout/route.ts) | admin sign-out |
| `/api/daily-pricing/update` | [app/api/daily-pricing/update/route.ts](../app/api/daily-pricing/update/route.ts) | pricing update |
| `/api/daily-pricing/seed` | [app/api/daily-pricing/seed/route.ts](../app/api/daily-pricing/seed/route.ts) | store initialization / diagnostics |

## Components

| File | Purpose |
| --- | --- |
| [components/marketing-page.tsx](../components/marketing-page.tsx) | main public workflow, address verification, PDF request, preview/share |
| [components/address-autocomplete.tsx](../components/address-autocomplete.tsx) | autocomplete UI wired to `/api/geo/autocomplete` |
| [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx) | internal admin UI for pricing and activity |
| [components/title-premium-calculator.tsx](../components/title-premium-calculator.tsx) | standalone title premium calculator UI |

## Core Library Modules

| Path | Responsibility |
| --- | --- |
| [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts) | Daily Pricing persistence, auth, rate history, analytics |
| [lib/propertyTax/calc.ts](../lib/propertyTax/calc.ts) | property-tax orchestration, fallback, caching |
| [lib/propertyTax/strategyRegistry.ts](../lib/propertyTax/strategyRegistry.ts) | county strategy selection |
| `lib/propertyTax/providers/metro/*` | metro-county-specific retrieval providers |
| [lib/propertyTax/presentation.ts](../lib/propertyTax/presentation.ts) | API response shaping for tax results |
| [lib/titlePremium/calc.ts](../lib/titlePremium/calc.ts) | Minnesota title premium math |
| [lib/apr/calc.ts](../lib/apr/calc.ts) | APR calculation logic |
| [lib/loanAmount.ts](../lib/loanAmount.ts) | loan amount validation bounds/messages |
| [lib/server/fetch-timeout.ts](../lib/server/fetch-timeout.ts) | timeout wrapper for external fetches |

## Persistence And State

Main Daily Pricing store:

- code: [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)
- KV key default: `stone-river-mortgage:daily-pricing:v1`
- filesystem fallback: `.data/daily-pricing.json` locally or `/tmp/stone-river-mortgage/daily-pricing.json` in serverless/prod fallback mode

Daily Pricing analytics:

- code: [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)
- KV key default: `stone-river-mortgage:daily-pricing:v1:analytics:v2`
- filesystem fallback: `.data/daily-pricing-analytics-v2.json`

Important absence:

- no SQL database
- no schema file
- no migration directory

## Tests

High-value test locations:

- [lib/daily-pricing-store.test.ts](../lib/daily-pricing-store.test.ts)
- [lib/propertyTax/calc.test.ts](../lib/propertyTax/calc.test.ts)
- [lib/propertyTax/strategyRegistry.test.ts](../lib/propertyTax/strategyRegistry.test.ts)
- [lib/titlePremium/calc.test.ts](../lib/titlePremium/calc.test.ts)
- [lib/apr/calc.test.ts](../lib/apr/calc.test.ts)
- [scripts/check-carver-tls.test.mjs](../scripts/check-carver-tls.test.mjs)

## Scripts

| Script | File | Purpose |
| --- | --- | --- |
| `npm run dev` | [scripts/reset-next-cache.mjs](../scripts/reset-next-cache.mjs) -> Next dev | starts local dev after clearing stale `.next` |
| `npm run dev:carver` | [scripts/dev-carver.mjs](../scripts/dev-carver.mjs) | local helper for Carver CA setup |
| `npm run check:carver-tls` | [scripts/check-carver-tls.mjs](../scripts/check-carver-tls.mjs) | diagnostic for Carver TLS trust issues |

## Systems That Do Not Exist

Future engineers commonly look for these and should know they are absent:

- no database layer
- no migrations
- no background jobs
- no queue consumers
- no separate admin backend
- no shared UI component library outside the local component files

## Read Next

- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/PROJECT_STATE.md](PROJECT_STATE.md)
- [docs/ENVIRONMENT.md](ENVIRONMENT.md)
