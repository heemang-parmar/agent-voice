// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchConnectionDetails } from '@/lib/client/connection-details-client';
import { TransportError } from '@/lib/client/transport';

const details = {
  serverUrl: 'wss://livekit.example.test',
  roomName: 'room_abc',
  participantIdentity: 'user_abc',
  participantToken: 'token.value.here',
  agentName: 'agent-voice',
  expiresAt: '2026-01-01T00:10:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchConnectionDetails', () => {
  it('POSTs an empty JSON object same-origin with no caching and returns the details', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, details));
    vi.stubGlobal('fetch', fetchMock);
    const signal = new AbortController().signal;
    await expect(fetchConnectionDetails(signal)).resolves.toEqual(details);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/connection-details');
    expect(init).toMatchObject({
      method: 'POST',
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('maps 503 to not_configured carrying only variable names', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(503, { error: 'not_configured', missing: ['LIVEKIT_URL'], invalid: [] }),
        ),
    );
    const error = await fetchConnectionDetails(new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TransportError);
    expect(error).toMatchObject({ code: 'not_configured', missing: ['LIVEKIT_URL'], invalid: [] });
  });

  it.each([
    [403, 'forbidden'],
    [429, 'rate_limited'],
    [500, 'server'],
  ])('maps HTTP %s to %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { error: 'x' })));
    await expect(fetchConnectionDetails(new AbortController().signal)).rejects.toMatchObject({
      code,
    });
  });

  it('rejects a malformed 200 body instead of connecting with garbage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { serverUrl: 'wss://x' })));
    await expect(fetchConnectionDetails(new AbortController().signal)).rejects.toMatchObject({
      code: 'server',
    });
  });

  it('maps network failures and aborts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchConnectionDetails(new AbortController().signal)).rejects.toMatchObject({
      code: 'network',
    });
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    await expect(fetchConnectionDetails(new AbortController().signal)).rejects.toMatchObject({
      code: 'aborted',
    });
  });
});
