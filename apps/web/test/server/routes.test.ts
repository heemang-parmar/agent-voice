// @vitest-environment node
import { idSchema } from '@agent-voice/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as health } from '@/app/api/health/route';
import * as connectionDetailsRoute from '@/app/api/connection-details/route';
import { randomId } from '@/lib/server/ids';

const ROUTE = 'http://localhost:3000/api/connection-details';

function clearLiveKitEnv(): void {
  vi.stubEnv('LIVEKIT_URL', '');
  vi.stubEnv('LIVEKIT_API_KEY', '');
  vi.stubEnv('LIVEKIT_API_SECRET', '');
  vi.stubEnv('AGENT_VOICE_ALLOWED_ORIGINS', '');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('randomId', () => {
  it('produces prefixed, protocol-safe, unpredictable identifiers', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const id = randomId('room');
      expect(id.startsWith('room_')).toBe(true);
      expect(idSchema.safeParse(id).success, id).toBe(true);
      expect(id.length).toBeLessThanOrEqual(64);
      seen.add(id);
    }
    expect(seen.size).toBe(200);
    // At least 128 bits of entropy after the prefix.
    expect(randomId('user').length - 'user_'.length).toBeGreaterThanOrEqual(22);
  });

  it('refuses prefixes that would break the identifier grammar', () => {
    expect(() => randomId('')).toThrow();
    expect(() => randomId('bad prefix')).toThrow();
  });
});

describe('GET /api/health', () => {
  it('reports liveness and whether the server is configured, without any values', async () => {
    clearLiveKitEnv();
    const response = await health();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', configured: false });
  });

  it('reports configured=true when the required variables are present', async () => {
    vi.stubEnv('LIVEKIT_URL', 'wss://livekit.example.test');
    vi.stubEnv('LIVEKIT_API_KEY', 'health-test-key');
    vi.stubEnv('LIVEKIT_API_SECRET', 'health-test-secret');
    vi.stubEnv('AGENT_VOICE_AGENT_NAME', 'health-test-agent');
    vi.stubEnv('AGENT_VOICE_ALLOWED_ORIGINS', 'http://localhost:3000');
    vi.stubEnv('AGENT_VOICE_TOKEN_TTL_SECONDS', '600');
    const response = await health();
    const body = JSON.stringify(await response.json());
    expect(body).toBe(JSON.stringify({ status: 'ok', configured: true }));
    expect(body).not.toContain('health-test');
  });
});

describe('app/api/connection-details/route', () => {
  it('only exports POST and opts out of caching', () => {
    expect(typeof connectionDetailsRoute.POST).toBe('function');
    expect('GET' in connectionDetailsRoute).toBe(false);
    expect(connectionDetailsRoute.dynamic).toBe('force-dynamic');
    expect(connectionDetailsRoute.runtime).toBe('nodejs');
  });

  it('wires the handler: 403 cross-origin, 503 same-origin while unconfigured', async () => {
    clearLiveKitEnv();
    const crossOrigin = await connectionDetailsRoute.POST(
      new Request(ROUTE, {
        method: 'POST',
        headers: { origin: 'https://evil.example.test', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const sameOrigin = await connectionDetailsRoute.POST(
      new Request(ROUTE, {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(sameOrigin.status).toBe(503);
    expect(sameOrigin.headers.get('cache-control')).toBe('no-store');
    expect(await sameOrigin.json()).toEqual({
      error: 'not_configured',
      missing: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
      invalid: [],
    });
  });
});
