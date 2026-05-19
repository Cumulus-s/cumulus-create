interface ActionPayload {
  requestId: string;
  actionSlug: string;
  externalUserId: string;
  relayUserId: string;
  input: Record<string, unknown>;
}

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function hasUsableSecret(secret: string): boolean {
  return secret.trim().length >= 16 && secret !== 'dev-only-replace-me';
}

function actionsSecret(): string | null {
  const secret = process.env.RELAY_ACTIONS_SECRET ?? 'dev-only-replace-me';
  if (process.env.NODE_ENV === 'production' && !hasUsableSecret(secret)) return null;
  return secret;
}

async function verify(
  body: string,
  signature: string | null,
): Promise<'ok' | 'missing_secret' | 'invalid_signature'> {
  const secret = actionsSecret();
  if (!secret) return 'missing_secret';
  if (!signature) return 'invalid_signature';
  const provided = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  if (!/^[0-9a-f]+$/i.test(provided)) return 'invalid_signature';
  const expected = await hmacHex(secret, body);
  return timingSafeEqual(provided.toLowerCase(), expected) ? 'ok' : 'invalid_signature';
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signatureStatus = await verify(rawBody, request.headers.get('x-relay-signature'));
  if (signatureStatus === 'missing_secret') {
    return json(500, { ok: false, error: 'actions_secret_not_configured' });
  }
  if (signatureStatus !== 'ok') {
    return json(401, { ok: false, error: 'invalid_signature' });
  }

  let payload: Partial<ActionPayload>;
  try {
    payload = JSON.parse(rawBody) as Partial<ActionPayload>;
  } catch {
    return json(400, { ok: false, error: 'invalid_json' });
  }
  if (
    typeof payload.actionSlug !== 'string' ||
    typeof payload.externalUserId !== 'string' ||
    typeof payload.input !== 'object' ||
    payload.input === null
  ) {
    return json(400, { ok: false, error: 'invalid_action_payload' });
  }

  if (payload.actionSlug === 'echo') {
    return json(200, { ok: true, output: payload.input ?? {} });
  }
  if (payload.actionSlug === 'create_project') {
    const title =
      typeof payload.input?.title === 'string' ? payload.input.title : 'Untitled project';
    return json(200, {
      ok: true,
      output: {
        projectId: `project_${payload.externalUserId.slice(0, 8)}`,
        title,
        createdFor: payload.externalUserId,
      },
    });
  }

  return json(404, { ok: false, error: `unknown_action:${payload.actionSlug}` });
}
