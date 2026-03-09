# Known Limitations

## External County Source Volatility

County provider reliability depends on external systems that can change behavior, block automated requests, or return inconsistent schemas.

Examples:

- Source HTML/API formats can change without notice.
- Some county systems may return intermittent 403/timeout responses.

The application handles this by falling back to estimation when retrieval is not defensible.

## Estimation Fallback Is Not Equivalent to County Retrieval

When county retrieval fails or is unavailable, estimation uses county-rate tables and purchase price inputs. This is clearly labeled but should not be treated as official tax data.

## Carver TLS Certificate Chain Requirements

Carver requests may require additional CA chain trust setup. Preferred production approach is `CARVER_CA_PEM`.

## Serverless Persistence Without KV

If KV REST variables are not configured in serverless environments, fallback filesystem persistence can be ephemeral and not shared across function instances.

## Scope Boundaries

- Minnesota-only address acceptance is enforced for transaction summary flows.
- Daily Pricing currently supports a seeded user model (no multi-user RBAC system).
