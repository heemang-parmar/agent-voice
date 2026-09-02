// @vitest-environment node
import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_BODY_BYTES,
  handleConnectionDetails,
  type ConnectionDetailsDeps,
  type MintTokenInput,
} from '@/lib/server/connection-details';
import { loadWebConfig } from '@/lib/server/env';
import { mintLiveKitToken } from '@/lib/server/livekit-token';
import { SlidingWindowRateLimiter } from '@/lib/server/rate-limit';

const ROUTE = 'http://localhost:3000/api/connection-details';
const ORIGIN = 'http://localhost:3000';

const env = {
  LIVEKIT_URL: 'wss://livekit.example.test',
  LIVEKIT_API_KEY: 'test-api-key',
  LIVEKIT_API_SECRET: 'test-secret',
};

interface Harness {
  deps: ConnectionDetailsDeps;
  minted: MintTokenInput[];
}

function harness(
  overrides: Partial<ConnectionDetailsDeps> = {},
  envOverride: Record<string, string | undefined> = env,
): Harness {
  const minted: MintTokenInput[] = [];
  let counter = 0;
  const deps: ConnectionDetailsDeps = {
    loadConfig: () => loadWebConfig(envOverride),
    mintToken: (input) => {
      minted.push(input);
      return Promise.resolve('placeholder-token');
    },
    randomId: (prefix) => `${prefix}_random${String(++counter)}`,
    clientLimiter: new SlidingWindowRateLimiter({ limit: 100, windowMs: 60_000 }),
    globalLimiter: new SlidingWindowRateLimiter({ limit: 1000, windowMs: 60_000 }),
    now: () => 1_700_000_000_000,
    ...overrides,
  };
  return { deps, minted };
}

function post(init: { headers?: Record<string, string>; body?: BodyInit | null } = {}): Request {
  return new Request(ROUTE, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      ...init.headers,
    },
    body: init.body === undefined ? '{}' : init.body,
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function expectSafeHeaders(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('vary')).toBe('Origin');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('access-control-allow-origin')).toBeNull();
  expect(response.headers.get('content-type')).toMatch(/^application\/json/);
}

describe('POST /api/connection-details', () => {
  it('issues connection details for a same-origin POST', async () => {
    const { deps, minted } = harness();
    const response = await handleConnectionDetails(post(), deps);
    expect(response.status).toBe(200);
    expectSafeHeaders(response);
    expect(await json(response)).toEqual({
      serverUrl: 'wss://livekit.example.test',
      roomName: 'room_random1',
      participantIdentity: 'user_random2',
      participantToken: 'placeholder-token',
      agentName: 'agent-voice',
      expiresAt: new Date(1_700_000_000_000 + 600_000).toISOString(),
    });
    expect(minted).toEqual([
      {
        apiKey: 'test-api-key',
        apiSecret: env.LIVEKIT_API_SECRET,
        identity: 'user_random2',
        roomName: 'room_random1',
        ttlSeconds: 600,
        agentName: 'agent-voice',
      },
    ]);
  });

  it('uses the configured agent name and TTL, never anything from the client', async () => {
    const { deps, minted } = harness(
      {},
      {
        ...env,
        AGENT_VOICE_AGENT_NAME: 'ops-voice',
        AGENT_VOICE_TOKEN_TTL_SECONDS: '120',
      },
    );
    const response = await handleConnectionDetails(post(), deps);
    expect(response.status).toBe(200);
    expect(minted[0]).toMatchObject({ agentName: 'ops-voice', ttlSeconds: 120 });
    expect(await json(response)).toMatchObject({
      agentName: 'ops-voice',
      expiresAt: new Date(1_700_000_000_000 + 120_000).toISOString(),
    });
  });

  it('rejects every method except POST', async () => {
    const { deps, minted } = harness();
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD']) {
      const response = await handleConnectionDetails(
        new Request(ROUTE, { method, headers: { origin: ORIGIN } }),
        deps,
      );
      expect(response.status, method).toBe(405);
      expect(response.headers.get('allow')).toBe('POST');
      expectSafeHeaders(response);
    }
    expect(minted).toHaveLength(0);
  });

  it('rejects missing, malformed and cross-origin requests with a generic 403', async () => {
    const { deps, minted } = harness();
    const cases: Record<string, string>[] = [
      { origin: '' },
      { origin: 'null' },
      { origin: 'https://evil.example.test' },
      { origin: 'http://localhost:3001' },
      { origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
      { origin: ORIGIN, 'sec-fetch-mode': 'navigate' },
    ];
    for (const headers of cases) {
      const request = new Request(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: '{}',
      });
      const response = await handleConnectionDetails(request, deps);
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(await json(response)).toEqual({ error: 'forbidden' });
      expectSafeHeaders(response);
    }
    expect(minted).toHaveLength(0);
  });

  it('returns 503 with missing variable names only when not configured', async () => {
    const { deps, minted } = harness({}, { LIVEKIT_URL: env.LIVEKIT_URL });
    const response = await handleConnectionDetails(post(), deps);
    expect(response.status).toBe(503);
    expectSafeHeaders(response);
    expect(await json(response)).toEqual({
      error: 'not_configured',
      missing: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
      invalid: [],
    });
    expect(minted).toHaveLength(0);
  });

  it('still enforces the origin allowlist while unconfigured', async () => {
    const { deps } = harness({}, {});
    const response = await handleConnectionDetails(
      post({ headers: { origin: 'https://evil.example.test' } }),
      deps,
    );
    expect(response.status).toBe(403);
  });

  it('bounds the declared and the actual body size', async () => {
    const { deps, minted } = harness();
    const declared = await handleConnectionDetails(
      post({ headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' }),
      deps,
    );
    expect(declared.status).toBe(413);
    expect(await json(declared)).toEqual({ error: 'payload_too_large' });

    const actual = await handleConnectionDetails(
      post({ body: `{"pad":"${'x'.repeat(MAX_BODY_BYTES + 10)}"}` }),
      deps,
    );
    expect(actual.status).toBe(413);
    expect(minted).toHaveLength(0);
  });

  it('rejects non-JSON, malformed and non-object bodies', async () => {
    const { deps, minted } = harness();
    const wrongType = await handleConnectionDetails(
      post({ headers: { 'content-type': 'text/plain' }, body: '{}' }),
      deps,
    );
    expect(wrongType.status).toBe(415);

    for (const body of ['', 'not json', '[]', '"string"', 'null', '42']) {
      const response = await handleConnectionDetails(post({ body }), deps);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toEqual({ error: 'invalid_request' });
    }
    expect(minted).toHaveLength(0);
  });

  it('refuses client-controlled connection parameters', async () => {
    const { deps, minted } = harness();
    const attempts = [
      { agentName: 'other-agent' },
      { roomName: 'someone-elses-room' },
      { identity: 'admin' },
      { ttl: 86_400 },
      { grants: { roomAdmin: true } },
      { model: 'gpt-realtime' },
      { endpoint: 'http://attacker.example.test' },
      { apiKey: 'abc' },
      { voice: 'x'.repeat(200) },
      { anything: true },
    ];
    for (const attempt of attempts) {
      const response = await handleConnectionDetails(post({ body: JSON.stringify(attempt) }), deps);
      expect(response.status, JSON.stringify(attempt)).toBe(400);
    }
    expect(minted).toHaveLength(0);
  });

  it('rate limits per client and globally with a Retry-After header', async () => {
    const { deps, minted } = harness({
      clientLimiter: new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000 }),
      globalLimiter: new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000 }),
    });
    const client = (ip: string) => post({ headers: { 'x-forwarded-for': ip } });
    expect((await handleConnectionDetails(client('10.0.0.1'), deps)).status).toBe(200);
    expect((await handleConnectionDetails(client('10.0.0.1'), deps)).status).toBe(200);
    const limited = await handleConnectionDetails(client('10.0.0.1'), deps);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await json(limited)).toEqual({ error: 'rate_limited' });
    expectSafeHeaders(limited);

    expect((await handleConnectionDetails(client('10.0.0.2'), deps)).status).toBe(200);
    // Global budget (3) is now exhausted for everyone.
    expect((await handleConnectionDetails(client('10.0.0.3'), deps)).status).toBe(429);
    expect(minted).toHaveLength(3);
  });

  it('returns a generic 500 when minting fails and logs only the error class', async () => {
    const log = vi.fn();
    const { deps } = harness({
      mintToken: () => Promise.reject(new TypeError('secret material must not appear')),
      log,
    });
    const response = await handleConnectionDetails(post(), deps);
    expect(response.status).toBe(500);
    expect(await json(response)).toEqual({ error: 'internal' });
    expectSafeHeaders(response);
    expect(log).toHaveBeenCalledWith('connection_details.mint_failed', { error: 'TypeError' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret material');
  });
});

describe('mintLiveKitToken', () => {
  it('signs a short-lived token with only the grants the app needs and a fixed dispatch', async () => {
    const input: MintTokenInput = {
      apiKey: env.LIVEKIT_API_KEY,
      apiSecret: env.LIVEKIT_API_SECRET,
      identity: 'user_test',
      roomName: 'room_test',
      ttlSeconds: 600,
      agentName: 'agent-voice',
    };
    const token = await mintLiveKitToken(input);
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);

    const claims = await new TokenVerifier(input.apiKey, input.apiSecret).verify(token);
    expect(claims.sub).toBe('user_test');
    expect(claims.video).toEqual({
      room: 'room_test',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: ['microphone'],
      canUpdateOwnMetadata: false,
    });
    expect(claims.roomConfig?.agents).toHaveLength(1);
    expect(claims.roomConfig?.agents[0]?.agentName).toBe('agent-voice');
    // The SDK stamps `nbf` (not-before) rather than `iat`; lifetime is exp - nbf.
    const { exp, nbf } = claims as { exp?: number; nbf?: number };
    expect(exp).toBeDefined();
    expect(nbf).toBeDefined();
    expect((exp ?? 0) - (nbf ?? 0)).toBe(600);
  });
});
