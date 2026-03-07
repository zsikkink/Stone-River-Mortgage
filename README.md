# Stone River Mortgage Marketing Site

Single-page Next.js marketing site for Stone River Mortgage, including a transaction summary PDF generator.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment Variables

Create `.env.local` from `.env.example`.

Required for all environments:

- `GOOGLE_MAPS_API_KEY`
  - Server-side only (do not expose as `NEXT_PUBLIC_*`).
  - Used by:
    - `/api/geo/autocomplete`
    - `/api/geo/verify-address`

Required for production admin access:

- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

Optional production hardening:

- `DAILY_PRICING_SEED_TOKEN`
  - Required to call `/api/daily-pricing/seed` in production.
- `DAILY_PRICING_KV_REST_URL` and `DAILY_PRICING_KV_REST_TOKEN`
  - Recommended for Vercel production so Daily Pricing updates are shared across API routes/functions.
  - Vercel KV defaults (`KV_REST_API_URL` / `KV_REST_API_TOKEN`) are also supported.
- `DAILY_PRICING_KV_KEY`
  - Optional KV key override (default: `stone-river-mortgage:daily-pricing:v1`).
- `DAILY_PRICING_ANALYTICS_KV_KEY`
  - Optional KV key override for activity analytics (default: `<DAILY_PRICING_KV_KEY>:analytics`).
- `DAILY_PRICING_DATA_DIR`
  - Overrides where `daily-pricing.json` is stored.
  - Defaults:
    - local: `./.data`
    - serverless/production: `/tmp/stone-river-mortgage`
- `CARVER_CA_PEM`
  - Preferred Carver county TLS fix for Vercel (PEM text, supports escaped `\n`).
- `NODE_EXTRA_CA_CERTS`
  - Optional local startup CA chain path (read once at Node startup).
- `CARVER_EXTRA_CA_BUNDLE`
  - Local helper input used by `npm run dev:carver`.
- `DAILY_PRICING_ALLOW_DEFAULT_SEEDED_CREDENTIALS`
  - Default `false`; set to `true` only for emergency override.

## Production Deployment (Vercel)

1. Add environment variables in Vercel Project Settings:
   - `GOOGLE_MAPS_API_KEY`
   - `DAILY_PRICING_SEEDED_EMAIL`
   - `DAILY_PRICING_SEEDED_PASSWORD`
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN` (recommended, via Vercel KV integration)
   - `CARVER_CA_PEM` (recommended for Carver county)
   - optional: `DAILY_PRICING_SEED_TOKEN`
2. Keep API routes on Node runtime (already configured with `export const runtime = "nodejs"`).
3. Deploy from `main`.
4. Verify:
   - address autocomplete works
   - `/api/property-tax` returns county/year metadata
   - transaction summary PDF renders
   - `npm run check:carver-tls` succeeds in an environment with `CARVER_CA_PEM` configured.

### Vercel Runtime Note

Daily Pricing settings are file-backed by default and use `/tmp/stone-river-mortgage` in serverless environments. `/tmp` is writable but ephemeral and not shared reliably across functions, so production should use KV REST (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `DAILY_PRICING_KV_REST_URL`/`DAILY_PRICING_KV_REST_TOKEN`) for durable shared pricing and persistent activity analytics.

## Verification Commands

```bash
npm run typecheck
npm test
npm run build
npm run check:carver-tls
```

## Daily Pricing Admin

Employee pricing admin page:

- `http://localhost:3000/dailypricing`

Development defaults (local only):

- Email: `mikesikkink99@gmail.com`
- Password: `Lending1!`

Production safety behavior:

- If production is running with default seeded credentials and no override, login is disabled until `DAILY_PRICING_SEEDED_EMAIL` and `DAILY_PRICING_SEEDED_PASSWORD` are configured.

From this page, employees can update the full transaction summary configuration:

- Core rates and assumptions (interest rate, discount point factor, APR spread, tax/insurance rates, monthly assumptions, loan-term label)
- All static fee amounts used in closing/funds sections
- Footer copy lines used in the generated PDF

Transaction summaries use the saved configuration values and print when rates/points were last updated.

## Transaction Summary Property Workflow

The transaction summary builder now uses a property-centric flow:

- Address must be selected from Google autocomplete suggestions and server-verified.
- County is extracted from the verified address.
- Property tax is computed with a hybrid method:
  - user-provided annual tax (if known), or
  - county-rate estimate from `lib/propertyTax/mnRates.ts`.

## Minnesota Property Tax Subsystem

Location:

- `lib/propertyTax/types.ts`
- `lib/propertyTax/strategyRegistry.ts`
- `lib/propertyTax/calc.ts`
- `app/api/property-tax/route.ts`

Behavior:

- Minnesota-only estimation path (non-MN requests are unresolved/rejected).
- Valuation basis is the existing transaction-summary `purchasePrice` input.
- Metro-priority county strategies are explicitly registered for:
  - `Hennepin`, `Ramsey`, `Dakota`, `Anoka`, `Washington`, `Scott`, `Carver`, `Wright`
- Non-metro counties use statewide strategy routing.
- Metro counties use real county-specific providers in:
  - `lib/propertyTax/providers/metro/hennepinProvider.ts`
  - `lib/propertyTax/providers/metro/ramseyProvider.ts`
  - `lib/propertyTax/providers/metro/dakotaProvider.ts`
  - `lib/propertyTax/providers/metro/anokaProvider.ts`
  - `lib/propertyTax/providers/metro/washingtonProvider.ts`
  - `lib/propertyTax/providers/metro/scottProvider.ts`
  - `lib/propertyTax/providers/metro/carverProvider.ts`
  - `lib/propertyTax/providers/metro/wrightProvider.ts`
- Metro providers use a two-step pattern:
  - MetroGIS ArcGIS is used for parcel discovery/matching.
  - Final annual tax amount/year is retrieved from county-authoritative sources by county provider:
    - Hennepin: `www16.co.hennepin.mn.us/taxpayments/taxesdue.jsp`
    - Ramsey: Ramsey ParcelData AttributedData API (with Beacon fallback)
    - Dakota: county tax statement history + statement PDF
    - Anoka: county property tax datalet workflow (`tax_all_ank`)
    - Washington: county tax search workflow (QuickSearch + bill detail APIs)
    - Scott: county property tax payments workflow
    - Carver: county property tax history workflow
    - Wright: county property-access search + property tax information datalet workflow
- Estimation fallback uses county effective rates from `lib/propertyTax/mnRates.ts` when metro retrieval is unresolved.
- If a county is missing from the rate table, `_DEFAULT` is used with lower confidence and fallback attribution.
- If a county lookup fails because of TLS certificate-chain validation, the app keeps strict TLS validation and falls back to estimate mode with explicit warning metadata.

### Carver County TLS Chain (Secure Fix)

Some environments may fail Carver county lookups with TLS errors such as:

- `UNABLE_TO_VERIFY_LEAF_SIGNATURE`

Production-friendly secure trust-store fix:

1. Obtain the required intermediate CA certificate chain in PEM format.
2. Preferred production (Vercel): set `CARVER_CA_PEM` to PEM text (not a file path).
   - Vercel Environment Variable key: `CARVER_CA_PEM`
   - Value: full PEM text (escaped `\n` is supported).
   - `CARVER_CA_PEM` is request-scoped to Carver provider requests only.
3. Local development options:
   - Preferred: `CARVER_CA_PEM` directly in shell env before launch.
   - Existing startup trust workflow still supported:
     - `export NODE_EXTRA_CA_CERTS=/absolute/path/to/certs/extra-ca-bundle.pem`
     - `npm run dev`
   - Local helper workflow:
     - `export CARVER_EXTRA_CA_BUNDLE=/absolute/path/to/certs/extra-ca-bundle.pem`
     - `npm run dev:carver`
     - Helper loads the file into `CARVER_CA_PEM` and also sets `NODE_EXTRA_CA_CERTS`.
4. Verify connectivity:
   - `npm run check:carver-tls`
5. Verify lookup behavior:
   - run a Carver address through `/api/property-tax` and confirm county lookup no longer falls back to estimate warnings.

Important startup note:
- `NODE_EXTRA_CA_CERTS` is read once when Node starts.
- Setting it in `.env.local` after `next dev` is already running will not fix TLS for the existing process.
- For Vercel production, prefer `CARVER_CA_PEM` so Carver trust is configured per-request without relying on startup-only global CA settings.

Deployment examples:
- Vercel: set `CARVER_CA_PEM` in Project Settings -> Environment Variables.
- `systemd`/containers (optional local parity): `NODE_EXTRA_CA_CERTS=/opt/stoneriver/certs/extra-ca-bundle.pem`

Do not use insecure production workarounds such as disabling TLS verification (`rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0`).

Result model:

- Returns structured metadata (`result_type`, `confidence`, `source_kind`, `matching_notes`, `retrieval_notes`, `estimation_notes`, `raw_evidence`, `strategy_key`, `fetched_at`).
- Includes explicit year metadata:
  - `requested_tax_year`
  - `actual_tax_year_used`
  - `year_match_status` (`matched` or `latest_available_used`)
- Result types:
  - `county_retrieved` for successful metro provider retrieval
  - `estimated` for statewide/non-metro or metro fallback estimates
  - `unresolved` when neither retrieval nor estimation is defensible

Extending county-specific logic:

1. Add or update county strategy entries in `lib/propertyTax/strategyRegistry.ts`.
2. Add county-specific provider modules under `lib/propertyTax/providers/metro` and register them in `lib/propertyTax/providers/metro/index.ts`.
3. Add county-specific retrieval/estimate orchestration in `lib/propertyTax/calc.ts` behind the selected strategy.
3. Keep `getAnnualPropertyTax(...)` as the orchestration entrypoint.
4. Add tests for selection, confidence, provenance, and unresolved behavior.

## MN Title Insurance Premium Calculator

- UI: `http://localhost:3000/dailypricing` (section: **MN Title Insurance Premiums**)
- API: `POST /api/title-premium`
- Loan amount bounds enforced in UI and API:
  - Minimum: `$125,000`
  - Maximum: `$832,750`

Example request body:

```json
{
  "purchasePrice": 425000,
  "loanAmount": 340000,
  "expandedOwnersCoverage": false,
  "refinance": false,
  "simultaneousIssue": true
}
```

Rate tables and constants are configurable in:

- `lib/titlePremium/configMN.ts`
- Assumption: when simultaneous issue applies, lender premium uses the flat fee and does **not** apply minimum premium.
- APR estimate uses an Excel-style `PMT + RATE` method (`lib/apr/calc.ts`) with defaults:
  - `pointsPercent = 0.09`
  - `underwritingFee = 1250`
  - `perDiemDays = 1`

Important: title insurance rates vary by underwriter, product, and transaction details. Verify all rates and rules before production use.

## Logo setup

The site is wired to use `public/logo.png` via Next/Image:

```tsx
<Image src="/logo.png" ... />
```

To replace the logo, overwrite:

- `public/logo.png`

The UI will show a placeholder card automatically if the logo file is missing or fails to load.
