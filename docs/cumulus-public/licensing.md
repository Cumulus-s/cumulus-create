# Licensing

Cumulus uses a split license model.

## License Map

| Area | License | Why |
| --- | --- | --- |
| Full web app/server, local Cumulus DB, local Knowledge runtime, Nimbus provider tooling, and self-hosted generated templates | AGPL-3.0-only | Networked service and provider/runtime improvements stay open when people run modified versions. |
| `@cmls/auth`, `@cmls/db`, and `@cmls/sdk` | Apache-2.0 | Public app-side integration helpers should be easy to adopt, fork, and use commercially. |
| Cloud-only generated starter apps that do not include local provider/runtime code | MIT | Small app-side examples can stay permissive when they only call Cumulus over HTTP/token APIs. |

## Boundary Rules

- Keep the database engine, storage layer, token system, search, secrets, HTTP server, and provider tests inside AGPL-marked areas.
- Keep public SDK integration code outside `apps/cumulus-db`. It must talk to Cumulus DB over HTTP/token APIs.
- Do not import `@cmls/cumulus-db` or `apps/cumulus-db` source from Apache-side SDK code.
- If a future shared protocol package is needed by Apache SDKs, create it outside `apps/cumulus-db` and license it Apache-2.0.
- Generated apps or examples that only call Cumulus Cloud over HTTP can use their own permissive license.
- Generated apps or examples that include files copied from `apps/cumulus-db` must keep those copied provider pieces AGPL-3.0-only.
- New files under `apps/cumulus-db/src` must start with:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

## Checks

Run:

```bash
npm run license:check
```

This verifies the package license map, Cumulus DB AGPL source headers, generated Cumulus DB template coverage, and the no-direct-import boundary between Apache SDKs and AGPL database-provider internals.
