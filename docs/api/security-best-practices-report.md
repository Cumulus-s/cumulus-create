# Security Best Practices Report

## Executive Summary

This release pass focused on the Next.js route handlers, generated project templates, Cumulus DB template integration, secret handling, package contents, and open-source release posture. No critical issue remains from this pass. Template fixes and checks now cover generated project naming, fail-closed webhook/action routes, and Cumulus DB HTTP-only app integration.

## Fixed Findings

### SBP-001: Generated projects could keep placeholder folder/package names

Severity: Low  
Location: `packages/create-cumulus/src/core.ts:170`, `packages/create-cumulus/src/core.ts:285`

The creator treated `my-acme` as a real directory even when the user supplied a real company name. That made generated project identity inconsistent across folder name, package name, README, metadata, and env defaults.

Fix: `my-acme` and `my-cumulus-app` are now treated as placeholders. When `--company "Launch Labs"` is supplied, the generated folder and package become `launch-labs`; explicit non-placeholder directories are preserved.

### SBP-002: Generated action webhook did not return a clean 400 for malformed JSON

Severity: Medium  
Location: `packages/create-cumulus/templates/integration/app/api/actions/route.ts:66`

The action route parsed JSON after signature verification without a local parse-error response. A malformed but signed body could produce a generic server error instead of a clear client error.

Fix: the route now catches JSON parse failures and returns `400 invalid_json`, then validates the minimum runtime shape before dispatching an action.

### SBP-003: Generated webhooks could silently use dev placeholder secrets in production

Severity: High if deployed unchanged  
Location: `packages/create-cumulus/templates/integration/src/relay/webhook.ts:96`, `packages/create-cumulus/templates/integration/app/api/actions/route.ts:36`

The generated integration templates used a local development fallback secret. That is useful for development, but dangerous if an operator deploys without setting `RELAY_WEBHOOK_SECRET` or `RELAY_ACTIONS_SECRET`.

Fix: production mode now rejects placeholder or too-short secrets before accepting signed callbacks. Local development behavior is preserved.

### SBP-004: Generated public legal/security pages claimed official Cumulus operator details

Severity: Medium  
Location: `packages/create-cumulus/templates/public/app/legal/privacy/page.tsx:44`, `packages/create-cumulus/templates/public/app/legal/terms/page.tsx:49`, `packages/create-cumulus/templates/public/app/security/page.tsx:146`

The file-based templates preserved official Cumulus contact and address text in generated public pages. That is not appropriate for self-hosted clones and could confuse users about who operates the deployment.

Fix: generated public pages now use `__COMPANY_NAME__` for operator wording and placeholder `example.com` contacts that the generated project owner must replace. Licensing copy now distinguishes MIT hosted starter pieces from AGPL full/self-hosted templates.

### SBP-005: Generated Cumulus DB integration could blur AGPL and app-code boundaries

Severity: High if implemented with direct imports
Location: `packages/create-cumulus/templates/cumulus-db-app`

The local Cumulus DB service is AGPL-3.0-only. Importing its source directly
into MIT generated app code would create a confusing license and deployment
boundary.

Fix: generated app code only uses HTTP/token proxy routes. Local DB source is
vendored under `apps/cumulus-db` with its own `LICENSE` and `NOTICE`, and local
DB projects conservatively default to AGPL-3.0-only.

## Current Residual Risks

### SBP-006: Sensitive auth/template ownership is currently single-maintainer in git history

Severity: Medium  
Evidence: ownership-map run against the last 12 months showed low bus factor for auth, secret, and template paths.

Impact: this does not create a runtime vulnerability, but it increases review risk before wider outside contribution.

Recommendation: require review on auth, crypto, billing, webhook, MCP, and `packages/create-cumulus/templates/**` changes through CODEOWNERS or branch protection once the public repository is fully active.

### SBP-007: Payload limits and edge rate limits are deployment-dependent

Severity: Medium  
Evidence: the app documents Vercel or another Node-compatible platform in `SELF_HOSTING.md`; route handlers rely on platform request handling for some payload-size protection.

Impact: a self-hosted deployment without reverse-proxy limits can be more exposed to oversized webhook or MCP requests.

Recommendation: document reverse-proxy payload limits in self-hosting docs and add an `env:check` or `self-host:check` script that warns when required production settings are missing.

## Verification Performed

- Creator package tests and typecheck passed after the fixes.
- Generated Cumulus DB file, script, env, README, UI route, and license
  assertions passed across template and DB-mode combinations.
- Local Cumulus DB service test, build, and generated start-script health check
  passed.
- Template scans found no remaining generated official Cumulus legal contacts.
- Ownership map was generated to `/tmp/cumulus-ownership-map-out` and not committed because it contains contributor metadata.
- Root `typecheck`, `test`, and `build` passed.
- Creator package `typecheck`, `test`, `build`, and `npm pack --dry-run` passed.
- All eight generated `template x agent-auth` combinations installed, typechecked, and built successfully.
- `npm audit --omit=dev --audit-level=moderate` passed with zero production advisories. Full dev audit has one remaining moderate `drizzle-kit` transitive `esbuild` advisory with no compatible current fix.
