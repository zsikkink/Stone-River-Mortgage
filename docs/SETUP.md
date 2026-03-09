# Setup

## Prerequisites

- Node.js 20+
- npm 10+

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create local env file:

```bash
cp .env.example .env.local
```

3. Set at minimum:

- `GOOGLE_MAPS_API_KEY`
- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

4. Start dev server:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000` (marketing page)
- `http://localhost:3000/dailypricing` (pricing admin)

## Optional: Carver TLS Local Workflow

If Carver county requests fail due certificate-chain validation:

- Preferred: set `CARVER_CA_PEM` in your shell before startup.
- Alternative: run `npm run dev:carver` with `CARVER_EXTRA_CA_BUNDLE` or `NODE_EXTRA_CA_CERTS` set.

To verify connectivity:

```bash
npm run check:carver-tls
```

## Validation Commands

```bash
npm run typecheck
npm test
npm run build
npm run verify
```
