# Cumulus DB Agent Instructions

This directory is the from-scratch Cumulus Database provider.

## License Boundary

- Code in this directory is AGPL-3.0-only.
- New TypeScript source files under `apps/cumulus-db/src` must start with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

- Do not move AGPL database-provider code into Apache-2.0 app areas.
- Do not make Apache-side code import this package directly. Use HTTP/token APIs.
- Shared protocol helpers that must be used by both sides should live outside this directory and remain Apache-2.0.

## What Belongs Here

- database engine behavior,
- local storage,
- search,
- token and permission checks,
- encrypted secret handling,
- provider HTTP routes,
- Cumulus DB tests and smoke checks.

## What Stays Outside

- Cumulus Cloud production secrets,
- private admin dashboards,
- customer data,
- deployment credentials,
- private provider wiring.

Run `npm run license:check`, `npm run db:test`, and `npm run db:build` after changing this directory.
