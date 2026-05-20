# @cmls/nimbus

Nimbus is the Cumulus desired-state manifest layer for Cumulus DB.

Source of truth: https://github.com/Cumulus-s/cumulus-create
Public mirror: https://github.com/Cumulus-s/nimbus

Package: https://www.npmjs.com/package/@cmls/nimbus
Rust crate: https://crates.io/crates/cmls-nimbus
License: AGPL-3.0-only

```bash
npm install @cmls/nimbus
cargo install cmls-nimbus
```

## What It Does

- Defines the stable TypeScript contracts agents use to describe desired DB state.
- Provides the Rust `cmls-nimbus` compiler for manifest validation and canonical JSON.
- Keeps schema planning at the Cumulus DB HTTP/API boundary instead of raw provider imports.

## Boundary

Nimbus provider/compiler tooling is AGPL-3.0-only. Permissive app and SDK code
should talk to Cumulus DB through HTTP/token APIs and should not import provider
runtime internals.

## Example

```ts
import type { NimbusManifest } from "@cmls/nimbus";

const manifest: NimbusManifest = {
  version: "v1alpha1",
  tables: [],
};
```
