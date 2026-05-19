import { cumulusDbPublicFetch } from '@/src/lib/cumulus-db/server';

export async function POST(request: Request) {
  return cumulusDbPublicFetch('/v1/env/parse', {
    method: 'POST',
    body: await request.text(),
  });
}
