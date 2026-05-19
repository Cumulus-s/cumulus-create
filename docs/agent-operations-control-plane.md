# Cumulus Agent Operations Control Plane

Cumulus is the cloud control plane. Altocumulus is the local terminal control
center. `create-cumulus` is the project generator. SDKs and MCP adapters are the
instrumentation surfaces.

## Planes

```text
Cumulus Cloud
  Auth, billing, orgs, projects, metrics, safe telemetry, dashboards

Altocumulus Local
  TUI, scanner, cache, local append-only ledger, MCP bridge, safe sync prep

User Project / Agent Runtime
  Auth SDK, DB SDK, Knowledge SDK, MCP tools, package commands, agent actions
```

Cloud sync defaults to creator-safe metadata only. V3 does not upload local
events or mutate remote state.

## Privacy Classes

- `public`: safe public data.
- `tenant_visible`: visible to the tenant or project owner when configured.
- `creator_safe_metadata`: safe metadata for platform/product analytics.
- `local_only`: local data that must not sync by default.
- `secret_never_store`: invalid for persisted events; redact and downgrade to
  `local_only` before writing.

Never store or sync credential values, `.env` values, access tokens, refresh
tokens, private keys, raw database rows, raw private knowledge content, or raw
prompts/completions without explicit tenant opt-in.

## Package Responsibilities

| Package | Responsibility |
| --- | --- |
| `create-cumulus` | Scaffold projects, install selected SDKs, write local config. |
| `@cumulus_cloud/altocumulus` | Local CLI/TUI, scanner bridge, cache, ledger viewer. |
| `@cumulus_cloud/events` | Shared event schema, redaction, privacy checks, JSONL writer. |
| `@cumulus_cloud/cloud-client` | Read-only cloud inventory client and safe sync payload prep. |
| `@cumulus/auth` | Agent Auth webhook helpers and safe account/key-ref events. |
| `@cumulus/db` | Agent DB HTTP client and safe operation metadata events. |
| `@cumulus_cloud/knowledge-sdk` | Knowledge SDK/runtime setup and safe retrieval metadata events. |
| `@cumulus_cloud/mcp` | MCP resources, tools, and prompts for safe agent metadata. |
| `@cumulus_cloud/server` | Server-side signup/action/API event hooks. |
| `@cumulus_cloud/cli` | Non-TUI command surface. |

Hard dependency rule: SDKs can import `@cumulus_cloud/events`; events cannot
import SDKs, Altocumulus, app code, or AGPL provider internals.

## V3 Cloud Rule

Altocumulus may read cloud inventory through `@cumulus_cloud/cloud-client`.
Altocumulus v3 must not call cloud mutation endpoints. Key minting, key
rotation, checkout, product creation, and project creation appear as disabled
action cards until a later plan defines confirmation and privacy behavior.
