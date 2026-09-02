import { handleConnectionDetails } from '@/lib/server/connection-details';
import { loadWebConfig } from '@/lib/server/env';
import { randomId } from '@/lib/server/ids';
import { mintLiveKitToken } from '@/lib/server/livekit-token';
import { SlidingWindowRateLimiter } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Per-client and process-wide budgets for token minting. */
const clientLimiter = new SlidingWindowRateLimiter({ limit: 10, windowMs: 60_000 });
const globalLimiter = new SlidingWindowRateLimiter({ limit: 300, windowMs: 60_000 });

function log(event: string, fields: Record<string, string | number> = {}): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

export function POST(request: Request): Promise<Response> {
  return handleConnectionDetails(request, {
    loadConfig: () => loadWebConfig(),
    mintToken: mintLiveKitToken,
    randomId,
    clientLimiter,
    globalLimiter,
    now: Date.now,
    log,
  });
}
