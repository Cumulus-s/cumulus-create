# @cls/events

Shared event schema and local ledger writer for Cumulus agent operations.

This package is the dependency every SDK may use. It does not import
Altocumulus, the cloud client, or any product SDK.

```ts
import { createEventEmitter } from "@cls/events";

const events = createEventEmitter({
  sourcePackage: "@cls/db",
  surface: "sdk",
  subsystem: "db",
  ledgerPath: ".cumulus/altocumulus/events.jsonl",
});

await events.emit({
  operation: "write",
  status: "ok",
  privacy: { class: "creator_safe_metadata", redacted: false },
  metadata: { table: "agent_tasks", row_count: 1 },
});
```

The ledger is append-only JSONL. Malformed lines are skipped during reads and
reported as recovery metadata.

## Privacy Rule

Never pass credential values, `.env` values, private keys, raw database rows,
raw private knowledge content, or raw prompts/completions into this package.
The redactor catches common mistakes, but callers own the first privacy boundary.
