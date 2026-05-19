# Licensing

Cumulus Create keeps package-level license boundaries.

- Full app/server, local Agent DB, local Knowledge runtime, Nimbus provider tooling, and self-hosted generated templates are AGPL-3.0-only.
- Public SDK/auth helper packages are Apache-2.0 unless their package file states a stricter license.
- App-side DB integration code must use HTTP/token APIs.
- Do not import `apps/cumulus-db` provider source from permissive packages.
