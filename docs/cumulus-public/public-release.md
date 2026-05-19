# Public Release Checklist

Use this checklist before publishing a public branch, release, tarball, or fresh-history export.

## Required Shape

- Public repo has fresh history.
- Production-only files stay in the private overlay.
- Public docs explain cloud-first and self-hosted setup.
- Public routes use user-scoped access.
- Admin/global systems are disabled unless the private overlay enables them.

## Remove Or Template

- `.env`, `.env.*`, runtime data, database dumps, logs.
- Real provider names when they reveal production infrastructure.
- Real project refs, tenant IDs, account IDs, and internal URLs.
- Private agent definitions, internal plans, operational debugging notes.
- Private package tarballs and private package registry config.
- Local MCP/server tooling that is not part of the public product.

## Scan

Run:

```bash
npm run security:scan
```

The scanner checks tracked files plus untracked, non-ignored files. Test fixtures with obvious fake values are allowed.

## Fresh History Export

Create the public repo from a clean export, not from this private repo history:

```bash
npm run public:export -- ../cumulus-public
```

The export command runs the public safety scan, copies only public Git-managed files into the target directory, initializes a new `main` branch, and creates the first public commit.

## Verify

Run:

```bash
npm install
npm run lint
npm run license:check
npm run test
npm run db:test
npm run build
```

Then test:

- cloud API configuration path,
- self-host Cumulus DB path,
- auth flow,
- dashboard database connection with a scoped token,
- legal pages with template provider data.

## Credential Rotation

If a real token, project ref, tenant ID, or provider credential ever appeared in tracked files, rotate it before public release. Removing it from the current tree is not enough if old history is published.
