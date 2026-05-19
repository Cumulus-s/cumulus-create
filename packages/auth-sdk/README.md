# @cmls/auth

Apache-2.0 server SDK for Cumulus Auth. It lets an app accept agent-driven
signup, action, API-key, and teardown webhooks without importing any AGPL
Cumulus DB provider code.

Source of truth: https://github.com/Cumulus-s/cumulus-create
Public mirror: https://github.com/Cumulus-s/auth

```bash
npm install @cmls/auth
```

## 60-second integration

```ts
import { cumulus } from "@cmls/auth";

export const POST = cumulus.webhook({
  secret: process.env.CUMULUS_AUTH_WEBHOOK_SECRET!,
  onSignup: async ({ email, input }) => {
    const user = await myAuth.createUser({ email, name: input.name });
    const apiKey = await myAuth.issueApiKey(user.id);
    return { accountId: user.id, apiKey };
  },
  onTeardown: async ({ account_id }) => {
    await myAuth.deleteUser(account_id);
  },
});
```

Register the endpoint in Cumulus Auth, store the webhook secret in your private
environment, and agents can sign users up through the same Cumulus account
system.

## Compatibility

Older integrations can keep importing `relay` from `@cmls/auth`. It is now a
compatibility alias for `cumulus`.

## Local usage ledger

Pass `events.ledgerPath` to record safe account and credential-reference
metadata into a local append-only JSONL ledger. The SDK never writes credential
values, API keys, raw request secrets, or `.env` values to that ledger.

## What you get

| Callback | Triggered when | Return |
|---|---|---|
| `onSignup` | An agent initiates signup for your app | `{ accountId, apiKey }` |
| `onCreateApiKey` | User or agent asks for another API key | `{ key, providerKeyId? }` |
| `onRevokeApiKey` | An existing key is revoked | `void` |
| `onTeardown` | Account is deleted from Cumulus Auth | `void` |

## Framework support

The handler is a standard `(Request) => Promise<Response>`. It works with
Next.js App Router, Hono, Bun, Deno, Cloudflare Workers, Vercel Functions, and
Node/Express adapters.

## Signature verification

Incoming requests use an HMAC-SHA256 signature header. The SDK verifies the raw
body with a timing-safe comparison before invoking your callback. A bad
signature returns `401` without calling your handler.

## License

Apache-2.0.
