# Project Structure

```text
.
├── app/
│   ├── api/
│   │   ├── daily-pricing/
│   │   ├── geo/
│   │   ├── property-tax/
│   │   ├── title-premium/
│   │   └── transaction-summary/
│   ├── dailypricing/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── address-autocomplete.tsx
│   ├── daily-pricing-page.tsx
│   ├── marketing-page.tsx
│   └── title-premium-calculator.tsx
├── lib/
│   ├── apr/
│   ├── propertyTax/
│   ├── titlePremium/
│   ├── daily-pricing-store.ts
│   └── loanAmount.ts
├── public/
│   ├── logo.png
│   ├── favicon.ico
│   └── equal-housing-lender-logo-png-transparent.png
├── scripts/
│   ├── check-carver-tls.mjs
│   ├── dev-carver.mjs
│   └── reset-next-cache.mjs
└── docs/
```

## Directory Responsibilities

- `app/`: routing and API entrypoints.
- `components/`: client-rendered UI components.
- `lib/`: business/domain logic and county integrations.
- `public/`: static assets used by UI/PDF rendering.
- `scripts/`: operational helpers for local development and diagnostics.
- `docs/`: project and operational documentation.
