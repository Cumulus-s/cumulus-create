# Private Production Overlay

The public repo is the shared source of truth. The private production overlay adds only the pieces that cannot be public.

## Keep Private

- real `.env` values,
- real provider accounts and dashboards,
- production legal provider lists,
- customer/user data,
- private admin tools,
- deployment credentials,
- internal incident notes and runbooks.

## Keep Public

- product UI,
- shared backend code,
- Cumulus DB engine,
- public API contracts,
- tests,
- self-host docs,
- cloud API client behavior,
- generic legal templates.

## License Boundary

- Full web app/server, local Cumulus DB, local Knowledge runtime, Nimbus provider tooling, and self-hosted generated templates stay AGPL-3.0-only.
- Public app-side SDKs such as `@cumulus/auth`, `@cumulus/db`, and `@cumulus/sdk` stay Apache-2.0.
- Private production may configure, deploy, and operate Cumulus DB, but database-provider engine changes should still land in the AGPL-covered public directory when safe.
- Keep private admin systems outside `apps/cumulus-db` unless they are intended to become AGPL-covered public provider code.

## Update Flow

1. Build public-safe changes in the public repo.
2. Pull those changes into the private production overlay.
3. Apply production-only config and admin wiring in the overlay.
4. Run public tests plus private deployment checks.
5. Tag matching versions when possible:
   - public: `vX.Y.Z`
   - production overlay: `cloud-vX.Y.Z`

This keeps one product while preventing leaks.
