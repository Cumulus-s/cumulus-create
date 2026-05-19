# Source Imports

This repo was created as the centralized Cumulus Create monorepo.

Imported source roots:

| Source | Imported into | Source commit |
| --- | --- | --- |
| `/Users/miguel/Documents/api` | `apps/web`, `packages/create-cumulus`, `packages/auth-sdk`, `packages/cli`, `packages/track-sdk`, `docs/api` | `5f8f116` |
| `/Users/miguel/Documents/cumulus/site/cumulus/apps/cumulus-db` | `apps/cumulus-db` | `dbed2aa` |
| `/Users/miguel/Documents/knowledge` | `crates/*`, `packages/knowledge-sdk`, `python`, `schemas/knowledge`, `docs/knowledge` | `0fe9635` |

The import copied current working-tree source files and intentionally skipped:

- `.env` and local secret files
- `node_modules`
- build outputs such as `dist`, `.next`, and `target`
- local runtime data
- large generated video/music assets from the old Agent Auth app

After this migration, new development for Cumulus Create should happen in this
repo. The old repos are historical source imports only.
