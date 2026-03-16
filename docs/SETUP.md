# Setup

Related docs:

- [docs/ONBOARDING.md](ONBOARDING.md)
- [docs/ENVIRONMENT.md](ENVIRONMENT.md)
- [docs/DEPLOYMENT.md](DEPLOYMENT.md)

## Prerequisites

- Node.js 20+
- npm 10+

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env template:

```bash
cp .env.example .env.local
```

3. Populate at minimum:

- `GOOGLE_MAPS_API_KEY`
- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

4. Start the dev server:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000`
- `http://localhost:3000/dailypricing`

## Optional: Carver TLS Local Workflow

If Carver county requests fail due to certificate-chain validation:

- preferred: set `CARVER_CA_PEM` before startup
- local helper: run `npm run dev:carver` with `CARVER_EXTRA_CA_BUNDLE` or
  `NODE_EXTRA_CA_CERTS` set

To verify connectivity:

```bash
npm run check:carver-tls
```

## Validation Commands

Recommended validation order:

```bash
npm test
npm run build
npm run typecheck
```

Or:

```bash
npm run verify
```

Important repo caveats:

- `npm run typecheck` relies on generated `.next/types`, so it is most reliable after
  `npm run build`.
- `npm run lint` is currently not a stable validation command because ESLint is not fully
  configured and Next.js will prompt interactively.
