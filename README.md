# Stone River Mortgage

Production-grade Next.js platform for **Stone River Mortgage** that combines a polished public marketing experience with a real operational pricing engine. It delivers county-aware Minnesota property-tax retrieval, configurable lending assumptions, and fast server-generated transaction summary PDFs from a single, maintainable TypeScript codebase.

Primary domain: `https://stonerivermortgage.com`

## Overview

This repository powers three core workflows:

1. Public one-page marketing site with lead CTAs and transaction-summary modal.
2. Internal `/dailypricing` admin for rate/fee configuration and activity analytics.
3. Server-generated transaction summary PDFs with Minnesota-specific tax/title logic.

## Key Features

- **Marketing page** with logo, mobile-first layout, application CTA, and in-page PDF preview.
- **Transaction summary builder** with:
  - Google Places address autocomplete + server verification
  - Minnesota-only address enforcement
  - purchase/down payment inputs (including custom percent or custom dollar amount)
  - PDF preview, download, and share actions
- **PDF generation API** (`/api/transaction-summary`) using `pdf-lib`, including:
  - dynamic loan/payment values
  - county tax year/source labels
  - title premium + APR calculations
  - Daily Pricing-controlled rates/fees/footer text
- **Minnesota property tax subsystem** with:
  - metro-county provider strategies
  - county retrieval + estimate fallback
  - explicit requested vs actual tax-year metadata
- **Daily Pricing admin** with credential-based sign-in, editable pricing configuration, rate-change history, and lookup/PDF activity analytics.

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS
- **Validation:** Zod
- **PDF engine:** pdf-lib
- **Tests:** Vitest

## Architecture At A Glance

- `app/` contains routes and API endpoints.
- `components/` contains UI for the marketing page, daily pricing dashboard, and address autocomplete.
- `lib/` contains business logic:
  - `daily-pricing-store.ts` for auth/config persistence/analytics
  - `propertyTax/` for county strategy/provider orchestration
  - `titlePremium/` and `apr/` for financial calculations

Detailed architecture docs are in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Local Development

### Prerequisites

- Node.js 20+
- npm 10+

### Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For full setup details, see [`docs/SETUP.md`](docs/SETUP.md).

## Environment Variables

This project uses server-side environment variables for APIs, admin auth, and persistence.

Minimum required:

- `GOOGLE_MAPS_API_KEY`
- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

Recommended in production:

- `DAILY_PRICING_KV_REST_URL`
- `DAILY_PRICING_KV_REST_TOKEN`
- `CARVER_CA_PEM`

Complete variable reference: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

## Scripts

```bash
npm run dev            # local development
npm run dev:carver     # local dev helper for Carver CA workflows
npm run build          # production build
npm run start          # run production build locally
npm run test           # run Vitest
npm run typecheck      # TypeScript checks
npm run verify         # typecheck + tests + build
npm run check:carver-tls
```

## Deployment (Vercel)

- Framework preset: **Next.js**
- Build command: `npm run build`
- Install command: `npm install`
- Output directory: leave default (`.next`)
- Runtime: Node.js (API routes are explicitly configured for Node runtime)

Deployment guide: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Repository Structure

High-level structure and file responsibilities are documented in [`docs/PROJECT_STRUCTURE.md`](docs/PROJECT_STRUCTURE.md).

## Documentation

- Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Setup: [`docs/SETUP.md`](docs/SETUP.md)
- Environment: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)
- Deployment: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- Limitations: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md)
- Contributing: [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md)
- Reviewer orientation: [`docs/REPOSITORY_REVIEW_GUIDE.md`](docs/REPOSITORY_REVIEW_GUIDE.md)

## Reviewer Guide

If you are reviewing this repository for architecture/code quality, start with:

1. [`docs/REPOSITORY_REVIEW_GUIDE.md`](docs/REPOSITORY_REVIEW_GUIDE.md)
2. [`app/api/transaction-summary/route.ts`](app/api/transaction-summary/route.ts)
3. [`lib/propertyTax/calc.ts`](lib/propertyTax/calc.ts)
4. [`lib/daily-pricing-store.ts`](lib/daily-pricing-store.ts)

## Known Limitations

Current external dependency and county-source limitations are tracked in [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

## License / Ownership

Copyright (c) Zack Sikkink.

This repository is proprietary and not licensed for public use, copying, modification, distribution, sublicensing, or sale without prior written permission. See [`LICENSE`](LICENSE).
