# @cls/server

Server-side integration helpers for Cumulus agent operations.

This package records safe metadata about signup, action, and API activity. It
does not store credential values, request bodies, private customer rows, or raw
agent prompts.

```ts
import { createCumulusServerEvents } from "@cls/server";

const events = createCumulusServerEvents({
  ledgerPath: ".cumulus/altocumulus/events.jsonl",
});

await events.recordApiCall({
  route: "/v1/signups",
  method: "POST",
  statusCode: 202,
  durationMs: 42,
});
```
