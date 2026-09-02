import { loadWebConfig } from '@/lib/server/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness probe for containers and load balancers. It says whether the
 * server has the configuration it needs and nothing else: no variable names,
 * no values, no versions.
 */
export function GET(): Promise<Response> {
  const configured = loadWebConfig().ok;
  return Promise.resolve(
    new Response(JSON.stringify({ status: 'ok', configured }), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    }),
  );
}
