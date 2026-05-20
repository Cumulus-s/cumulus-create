# @cmls/sdk

`@cmls/sdk` is the small composed SDK for Cumulus apps and agents.

Source of truth: https://github.com/Cumulus-s/cumulus-create
Public mirror: https://github.com/Cumulus-s/sdk

Package: https://www.npmjs.com/package/@cmls/sdk
License: Apache-2.0

```bash
npm install @cmls/sdk
```

## What It Includes

- `@cmls/auth` exports for agent signup, action, API-key, and teardown webhooks.
- `@cmls/db` exports for token-scoped Cumulus DB HTTP calls.
- A small system client for account console and hosted Cumulus flows.

## Boundary

This package is Apache-2.0 and does not import local AGPL provider/runtime code.
Apps should use HTTP/token APIs for Cumulus DB and hosted Cumulus services.

Nimbus is shipped separately as `@cmls/nimbus` and `cmls-nimbus` because the
compiler/provider tooling is AGPL-3.0-only.

## Example

```ts
import { CumulusDbClient, cumulus } from "@cmls/sdk";

export const POST = cumulus.webhook({
  secret: process.env.CUMULUS_AUTH_WEBHOOK_SECRET!,
  onSignup: async ({ email }) => ({ accountId: email }),
});

const db = new CumulusDbClient({
  baseUrl: process.env.CUMULUS_DB_BASE_URL!,
  databaseId: process.env.CUMULUS_DB_ID!,
  token: process.env.CUMULUS_DB_TOKEN!,
});
```
