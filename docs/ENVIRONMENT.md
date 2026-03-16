# Environment Variables

This project intentionally keeps sensitive configuration server-side.

Important truth:

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is not required by the current repo flow.
- Address autocomplete and verification both use internal server APIs backed by
  `GOOGLE_MAPS_API_KEY`.

## Local Env Files

- `.env.example` is the template to copy from.
- `.env.local` is ignored by Git and should remain local-only.
- Do not commit real keys or credentials.

## Required Variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_MAPS_API_KEY` | Yes | Google Places calls in `/api/geo/autocomplete` and `/api/geo/verify-address`. |
| `DAILY_PRICING_SEEDED_EMAIL` | Production recommended | Daily Pricing sign-in identity. |
| `DAILY_PRICING_SEEDED_PASSWORD` | Production recommended | Daily Pricing sign-in password. |

## Daily Pricing Persistence

Use KV REST in production to keep pricing and analytics shared across functions.

The current Daily Pricing analytics series intentionally uses a separate v2 key so new
activity can start fresh without mutating or deleting legacy analytics data.

| Variable | Required | Notes |
| --- | --- | --- |
| `DAILY_PRICING_KV_REST_URL` | Recommended | Primary KV REST URL for the main store. |
| `DAILY_PRICING_KV_REST_TOKEN` | Recommended | Primary KV REST token for the main store. |
| `KV_REST_API_URL` | Supported alias | Vercel KV alias for URL. |
| `KV_REST_API_TOKEN` | Supported alias | Vercel KV alias for token. |
| `UPSTASH_REDIS_REST_URL` | Supported alias | Alternate alias. |
| `UPSTASH_REDIS_REST_TOKEN` | Supported alias | Alternate alias. |
| `DAILY_PRICING_KV_KEY` | Optional | Main Daily Pricing store key. Defaults to `stone-river-mortgage:daily-pricing:v1`. |
| `DAILY_PRICING_ANALYTICS_V2_KV_KEY` | Optional | Active analytics key. Defaults to `${DAILY_PRICING_KV_KEY}:analytics:v2`. |
| `DAILY_PRICING_ANALYTICS_KV_KEY` | Legacy only | Older analytics key. Current analytics code does not read or write it. |

## Optional Variables

| Variable | Purpose |
| --- | --- |
| `DAILY_PRICING_SEED_TOKEN` | Protects `/api/daily-pricing/seed` in production. |
| `DAILY_PRICING_DATA_DIR` | Local/custom filesystem path for fallback JSON storage. |
| `DAILY_PRICING_ALLOW_DEFAULT_SEEDED_CREDENTIALS` | Emergency override for default login in production (`true` only if intentional). |

## Carver County TLS Variables

| Variable | Purpose |
| --- | --- |
| `CARVER_CA_PEM` | Preferred production fix: PEM chain text for Carver request-scoped TLS trust. |
| `CARVER_EXTRA_CA_BUNDLE` | Local helper input for `npm run dev:carver` (path to PEM file). |
| `NODE_EXTRA_CA_CERTS` | Optional startup-level CA extension. Read only at Node startup. |
| `CARVER_TLS_CHECK_URL` | Optional override for `npm run check:carver-tls`. |

## Operational Notes

- In serverless environments without KV configured, filesystem fallback is not durable
  across function instances.
- The filesystem fallback keeps the main store in `daily-pricing.json` and the current
  analytics series in `daily-pricing-analytics-v2.json`.
- `NODE_EXTRA_CA_CERTS` must be exported before Node starts; setting it after startup has
  no effect on the current process.
