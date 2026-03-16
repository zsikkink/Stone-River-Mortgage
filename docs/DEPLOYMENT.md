# Deployment

Related docs:

- [docs/ENVIRONMENT.md](ENVIRONMENT.md)
- [docs/PROJECT_STATE.md](PROJECT_STATE.md)

## Target Platform

Primary deployment target is **Vercel**.

## Vercel Project Settings

- Framework Preset: `Next.js`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: default (`.next`)
- Node.js Version: `20.x` (recommended)

## Required Environment Variables

Set these in Vercel project settings for each environment where needed:

- `GOOGLE_MAPS_API_KEY`
- `DAILY_PRICING_SEEDED_EMAIL`
- `DAILY_PRICING_SEEDED_PASSWORD`

Recommended for production stability:

- `DAILY_PRICING_KV_REST_URL` and `DAILY_PRICING_KV_REST_TOKEN`
  - or Vercel aliases `KV_REST_API_URL` / `KV_REST_API_TOKEN`
- `CARVER_CA_PEM`

Optional:

- `DAILY_PRICING_SEED_TOKEN`

## Deployment Checklist

1. Run local validation:

```bash
npm run verify
```

2. Confirm env variables are present in Vercel.
3. Deploy from `main`.
4. Post-deploy smoke tests:
   - homepage loads
   - address autocomplete returns suggestions
   - transaction summary generates successfully
   - `/dailypricing` sign-in works
   - property tax API returns county/year metadata

There are no database migrations or worker rollout steps in the current architecture.

## Carver TLS in Production

Use `CARVER_CA_PEM` (PEM text) for request-scoped trust on Carver requests.
Do not use insecure TLS bypasses.

## Troubleshooting

- **Daily Pricing not persisting across deploys/functions:** enable KV REST vars.
- **Carver lookup fallback due TLS:** verify `CARVER_CA_PEM` and run `npm run check:carver-tls`.
- **Daily Pricing disabled in production:** verify seeded email/password vars are populated for that environment and redeploy.
