# @cumulus/db

Apache-2.0 HTTP SDK for Cumulus DB.

This package does not import the local AGPL database provider. It talks to a
hosted or local Cumulus DB service through token-scoped HTTP APIs.

```ts
import { CumulusDbClient } from "@cumulus/db";

const db = new CumulusDbClient({
  baseUrl: "http://localhost:4317",
  databaseId: "cdb_...",
  token: "cdb_data_...",
});

await db.writeProgress({
  title: "Bootstrap finished",
  content: "create-cumulus generated the project and installed SDKs.",
  metadata: { step: "bootstrap", status: "done" },
});
```

## Local usage ledger

Pass `events.ledgerPath` to emit safe database metadata into
`@cumulus_cloud/events`. The event records operation, route shape, status,
duration, hashed database refs, row type, counts, and hashes. It does not record
tokens, raw row bodies, connection strings, or secret field values.

## License

Apache-2.0.
