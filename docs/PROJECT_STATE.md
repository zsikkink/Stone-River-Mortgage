# Project State

This document reflects repository state audited on March 16, 2026. It is based on the
codebase in this repository, not live production data.

Related docs:

- [docs/ARCHITECTURE.md](ARCHITECTURE.md)
- [docs/KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)
- [docs/ENVIRONMENT.md](ENVIRONMENT.md)

## Implemented And Working

The following systems are clearly implemented in-repo:

- public marketing page with address entry, PDF preview, and apply/share flows
- Google Places autocomplete and verified-address lookup through server APIs
- Minnesota-only transaction summary workflow
- property-tax retrieval with metro county providers and estimate fallback
- server-side PDF generation through `pdf-lib`
- Daily Pricing auth, mutable pricing config, and rate history
- Daily Pricing analytics for successful PDF addresses and county outcome summaries
- title premium and APR calculation utilities with tests

## Structural Realities

- This is a single Next.js app, not a monorepo.
- There is no database, migration system, or schema directory.
- There is no worker, job queue, or background processing layer.
- Persistence is implemented inside [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts).

## Current Analytics State

Daily Pricing analytics were recently redesigned around successful PDF addresses:

- only successful PDF generations are tracked
- analytics use a separate v2 namespace/key from legacy analytics
- the top-line PDF count is cumulative
- the tracked-address list is cumulative by successful PDF address
- county performance rates use unique successful-PDF addresses as the denominator
- the old cumulative property-tax lookup counter is not part of the surfaced dashboard

If you need metric definitions, start with:

- [lib/daily-pricing-store.ts](../lib/daily-pricing-store.ts)
- [app/api/daily-pricing/route.ts](../app/api/daily-pricing/route.ts)
- [components/daily-pricing-page.tsx](../components/daily-pricing-page.tsx)

## Fragile Or Operationally Sensitive Areas

Property tax sources:

- Metro county providers depend on external county systems that can change markup,
  anti-bot behavior, or certificate chains without warning.
- Estimate fallback is expected behavior, not necessarily a bug.

Daily Pricing persistence:

- Store updates are full-object rewrites.
- Analytics updates are full-object rewrites.
- There are no atomic counters or append-only event logs.
- In serverless environments without KV, filesystem fallback is not durable across functions.

Authentication:

- Daily Pricing uses a seeded user model.
- Production blocks default seeded credentials unless explicitly overridden.

Tooling:

- `npm run lint` is not fully configured and should not be treated as a stable gate.
- `npm run typecheck` depends on generated `.next/types`, so it is safest after build.

Product/config constants:

- The transaction summary route contains a hard-coded appraisal promo end date:
  `APPRAISAL_PROMO_END_EXCLUSIVE` in
  [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts).

## Areas A Future Engineer Should Verify Before Extending

Before changing analytics:

- confirm whether you are working with the active analytics v2 series or legacy embedded
  analytics fields
- confirm whether the change is meant to affect successful PDF tracking or only UI display

Before changing Daily Pricing persistence:

- verify whether the deployment environment has KV configured
- verify whether a new field belongs in the main store blob or the analytics blob

Before changing property-tax flows:

- verify current provider behavior with tests and, if necessary, live county responses
- preserve fallback/source-label semantics unless the product explicitly wants them changed

Before changing PDF output:

- verify assumptions in [app/api/transaction-summary/route.ts](../app/api/transaction-summary/route.ts)
- check title premium and APR calculations in `lib/`

## Likely Next Work Areas

These are informed by the current code shape and recent changes, not by a formal roadmap:

- continued Daily Pricing analytics/reporting clarification
- property-tax provider maintenance as county systems drift
- hardening Daily Pricing persistence semantics if audit-grade metrics become important
- replacing the seeded-user model with stronger admin auth if operational scope grows
- configuring a stable linting setup so repo validation is less ambiguous

## What Is Not Verified Here

The repository does not prove:

- live production KV contents
- current Google Places quotas/settings
- current county-site behavior outside tests
- current Vercel project configuration beyond what the docs and env names imply

Those require environment access or live verification.
