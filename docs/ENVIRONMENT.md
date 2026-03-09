# Environment Variables

This project intentionally keeps sensitive configuration server-side.

Important: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is **not** required by this codebase.
Address autocomplete runs through internal APIs using `GOOGLE_MAPS_API_KEY` on the server.

## Required Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Yes | Google Places API calls in `/api/geo/autocomplete` and `/api/geo/verify-address`. |
| `DAILY_PRICING_SEEDED_EMAIL` | Production recommended | Daily Pricing sign-in identity. |
| `DAILY_PRICING_SEEDED_PASSWORD` | Production recommended | Daily Pricing sign-in password. |

## Daily Pricing Persistence

Use KV REST in production to keep pricing + analytics shared across functions.

| Variable | Required | Notes |
| --- | --- | --- |
| `DAILY_PRICING_KV_REST_URL` | Recommended | Primary KV REST URL for pricing store. |
| `DAILY_PRICING_KV_REST_TOKEN` | Recommended | Primary KV REST token for pricing store. |
| `KV_REST_API_URL` | Supported alias | Vercel KV naming alias for URL. |
| `KV_REST_API_TOKEN` | Supported alias | Vercel KV naming alias for token. |
| `UPSTASH_REDIS_REST_URL` | Supported alias | Alternate alias. |
| `UPSTASH_REDIS_REST_TOKEN` | Supported alias | Alternate alias. |
| `DAILY_PRICING_KV_KEY` | Optional | Custom key for pricing config. |
| `DAILY_PRICING_ANALYTICS_KV_KEY` | Optional | Custom key for analytics counters. |

## Optional Variables

| Variable | Purpose |
| --- | --- |
| `DAILY_PRICING_SEED_TOKEN` | Protects `/api/daily-pricing/seed` in production. |
| `DAILY_PRICING_DATA_DIR` | Local/custom filesystem path for fallback JSON store. |
| `DAILY_PRICING_ALLOW_DEFAULT_SEEDED_CREDENTIALS` | Emergency override for default login in production (`true` only if intentional). |

## Carver County TLS Variables

| Variable | Purpose |
| --- | --- |
| `CARVER_CA_PEM` | Preferred production fix: PEM chain text for Carver request-scoped TLS trust. |
| `CARVER_EXTRA_CA_BUNDLE` | Local helper input for `npm run dev:carver` (path to PEM file). |
| `NODE_EXTRA_CA_CERTS` | Optional startup-level CA extension (read at Node startup only). |
| `CARVER_TLS_CHECK_URL` | Optional override for diagnostic script target URL. |

## Operational Notes

- In serverless environments without KV configured, filesystem fallback is not durable across function instances.
- `NODE_EXTRA_CA_CERTS` must be exported **before** Node starts; setting it after startup has no effect on the current process.
