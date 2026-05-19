# Releasing

Cumulus releases are cut from the public repo, not from private production history.

## Versioning

- Use semantic versioning.
- Tag releases as `vX.Y.Z`.
- Keep `CHANGELOG.md` as the public version ledger.

## Required Checks

Run these before tagging:

```bash
npm audit --omit=dev --audit-level=high
npm run release:verify
npm run release:pack
npm run build
```

`npm run lint` must exit successfully. In this repo it runs typecheck plus the
license and public-safety scans.

## License Boundary

- Full app/server, local Cumulus DB, local Knowledge runtime, Nimbus tooling,
  and self-hosted generated templates: AGPL-3.0-only.
- `@cumulus/auth`, `@cumulus/db`, and `@cumulus/sdk`: Apache-2.0.
- `@cumulus/nimbus`: AGPL-3.0-only.
- App-side code must talk to Cumulus DB over HTTP/token APIs.
- Do not import AGPL database-provider code into Apache-side SDK code.

## Release Flow

1. Update `CHANGELOG.md`.
2. Run the required checks.
3. Commit the release notes.
4. Create an annotated tag:

```bash
git tag -a vX.Y.Z -m "Cumulus vX.Y.Z"
```

5. Push `main` and the tag.
6. Create a GitHub release from the changelog section.
