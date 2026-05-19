import { NextResponse } from 'next/server';

export function cumulusDbBaseUrl(): string {
  return (
    process.env.CUMULUS_DB_INTERNAL_URL ||
    process.env.CUMULUS_DB_PUBLIC_URL ||
    '__CUMULUS_DB_FALLBACK_URL__'
  ).replace(/\/$/, '');
}

async function proxyCumulusDbFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${cumulusDbBaseUrl()}${path}`, {
    ...init,
    cache: 'no-store',
  });

  const text = await response.text();
  return new NextResponse(text || null, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function cumulusDbTokenFetch(
  request: Request,
  path: string,
  init: RequestInit = {},
) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) {
    return NextResponse.json(
      { error: 'A Cumulus DB bearer token is required for this route.' },
      { status: 401 },
    );
  }

  const headers = new Headers(init.headers);
  headers.set('Authorization', authorization);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return proxyCumulusDbFetch(path, {
    ...init,
    headers,
  });
}

export async function cumulusDbPublicFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return proxyCumulusDbFetch(path, {
    ...init,
    headers,
  });
}
