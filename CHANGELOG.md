# Changelog

All notable public Cumulus Create changes are recorded here.

## [0.1.1] - 2026-05-19

Metadata cleanup for the CMLS public package registry and release workflow.

### Changed

- **CMLS create metadata** - Updates `@cmls/create` package metadata so npm shows the current CMLS naming instead of the older public-scope wording.
- **npm release workflow** - Skips workspace versions that are already published, so a targeted package patch can ship without republishing every public package.

## [0.1.0] - 2026-05-19

Initial public CMLS release.

### Added

- **CMLS package scope** - Public npm packages now use the `@cmls/*` scope, with `npm create @cmls` as the project creation command.
- **Public split mirrors** - `Cumulus-s/auth`, `Cumulus-s/sdk`, `Cumulus-s/cumulus-db`, and `Cumulus-s/nimbus` are generated from this monorepo.
- **Cumulus DB provider** - Ships the AGPL-3.0-only local/dev database service with system namespace contracts, Nimbus schema planning, snapshots, audit records, OpenAPI, and Postgres conformance tests.
- **Nimbus tooling** - Ships TypeScript contracts and the Rust `cmls-nimbus` compiler crate for desired-state manifests.
- **SDK surface** - Ships Apache-2.0 auth, DB, and composed SDK packages, plus MIT helper packages for events, cloud metadata, MCP, CLI, tracking, and project creation.
- **Knowledge runtime** - Ships CMLS Knowledge packages for npm, crates.io, and PyPI with local graph/indexing and MCP helper surfaces.
- **Release automation** - Adds manual GitHub workflows for npm provenance publishing, crates publishing, PyPI publishing, and split-repo synchronization.

### Verified

- `npm run release:verify`
- npm `publish --dry-run` for every `@cmls/*` workspace
- `cargo package` for `cmls-nimbus`, `cmls-knowledge-core`, and `cmls-knowledge-cli`
- Python build and `twine check` for `cmls-knowledge`
