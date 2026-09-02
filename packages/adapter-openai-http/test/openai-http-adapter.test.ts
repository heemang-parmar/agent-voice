import type { ActionContext, AdapterRequest } from '@agent-voice/adapter-sdk';
import { LIMITS } from '@agent-voice/protocol';
import { describe, expect, it, vi } from 'vitest';

import { OpenAiHttpAdapter, type AdapterLogger } from '../src/index.js';

// Deliberately not shaped like a real provider key so the repository secret
// scanner stays strict; the tests only need a distinctive string to assert on.
const SECRET = 'test-bearer-DO-NOT-LOG-1234567890';

const request: AdapterRequest = {
  conversationId: 'conv_1',
  actionId: 'act_1',
  text: 'Summarize the nightly build failures',
  sessionKey: 'session-abc',
};

function context(signal = new AbortController().signal): ActionContext {
  return {
    signal,
    deadline: Date.now() + 10_000,
    progress: vi.fn(),
    artifact: vi.fn(),
    requestApproval: vi.fn(() => Promise.resolve('approved' as const)),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

function completion(content: unknown, finishReason = 'stop') {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
  };
}

function verifiedResult(summary: string) {
  return JSON.stringify({
    status: 'verified',
    summary,
    verification: { state: 'verified', method: 'agent:tool-check' },
  });
}

function makeLogger(): AdapterLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    warn(event, fields) {
      lines.push(JSON.stringify({ event, ...fields }));
    },
  };
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

/** A typed stand-in for `fetch` that records calls and rejects (never throws) on handler errors. */
function mockFetch(handler: Handler) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const recorded = init ?? {};
    calls.push({ url, init: recorded });
    return new Promise<Response>((resolve) => {
      resolve(handler(url, recorded));
    });
  };
  return { fetchImpl, calls };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('expected a JSON string body');
  return JSON.parse(init.body) as Record<string, unknown>;
}

type Options = ConstructorParameters<typeof OpenAiHttpAdapter>[0];

function adapterWith(handler: Handler, extra: Partial<Options> = {}) {
  const logger = makeLogger();
  const { fetchImpl, calls } = mockFetch(handler);
  const adapter = new OpenAiHttpAdapter({
    endpoint: 'http://127.0.0.1:8642/v1/',
    apiKey: SECRET,
    model: 'hermes-local',
    fetch: fetchImpl,
    logger,
    ...extra,
  });
  return { adapter, logger, calls };
}

describe('OpenAiHttpAdapter', () => {
  it('posts a bounded, non-streaming chat completion with bearer and session headers', async () => {
    const { adapter, calls } = adapterWith(() =>
      jsonResponse(completion(verifiedResult('Two jobs failed.'))),
    );

    const result = await adapter.run(request, context());

    expect(result.status).toBe('verified');
    expect(result.summary).toBe('Two jobs failed.');
    expect(result.verification.state).toBe('verified');
    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error('fetch was not called');
    expect(call.url).toBe('http://127.0.0.1:8642/v1/chat/completions');
    expect(call.init.method).toBe('POST');
    const headers = new Headers(call.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(headers.get('x-session-key')).toBe('session-abc');
    expect(headers.get('content-type')).toBe('application/json');
    const body = bodyOf(call.init);
    expect(body.model).toBe('hermes-local');
    expect(body.stream).toBe(false);
    expect(body.user).toBe('session-abc');
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.at(-1)).toEqual({ role: 'user', content: request.text });
  });

  it('omits the authorization header when no key is configured and honours a custom session header', async () => {
    const { adapter, calls } = adapterWith(() => jsonResponse(completion('ok')), {
      apiKey: undefined,
      sessionHeader: 'X-Agent-Session',
    });
    await adapter.run(request, context());
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.get('x-agent-session')).toBe('session-abc');
  });

  it('accepts structured result JSON split across list-of-parts content', async () => {
    const resultJson = verifiedResult('First part. Second part.');
    const midpoint = Math.floor(resultJson.length / 2);
    const { adapter } = adapterWith(() =>
      jsonResponse(
        completion([
          { type: 'text', text: resultJson.slice(0, midpoint) },
          { type: 'image_url', image_url: { url: 'https://example.com/x.png' } },
          { type: 'text', text: resultJson.slice(midpoint) },
        ]),
      ),
    );
    const result = await adapter.run(request, context());
    expect(result.status).toBe('verified');
    expect(result.summary).toBe('First part. Second part.');
  });

  it('never treats unstructured assistant prose as verified action evidence', async () => {
    const { adapter } = adapterWith(() => jsonResponse(completion('Done.')));
    const result = await adapter.run(request, context());
    expect(result.status).toBe('failed');
    expect(result.verification.state).toBe('unverified');
  });

  it.each([
    [
      'contradictory verified status',
      {
        status: 'verified',
        summary: 'Done.',
        verification: { state: 'unverified', method: 'agent:check' },
      },
    ],
    [
      'contradictory failed status',
      {
        status: 'failed',
        summary: 'Failed.',
        verification: { state: 'verified', method: 'agent:check' },
      },
    ],
    [
      'unknown top-level field',
      {
        status: 'verified',
        summary: 'Done.',
        verification: { state: 'verified', method: 'agent:check' },
        extra: true,
      },
    ],
    [
      'unknown verification field',
      {
        status: 'verified',
        summary: 'Done.',
        verification: { state: 'verified', method: 'agent:check', extra: true },
      },
    ],
    [
      'blank method',
      { status: 'verified', summary: 'Done.', verification: { state: 'verified', method: '   ' } },
    ],
    [
      'oversized summary',
      {
        status: 'verified',
        summary: 'x'.repeat(LIMITS.maxTextChars + 1),
        verification: { state: 'verified', method: 'agent:check' },
      },
    ],
    [
      'oversized detail',
      {
        status: 'verified',
        summary: 'Done.',
        verification: { state: 'verified', method: 'agent:check', detail: 'x'.repeat(1001) },
      },
    ],
    [
      'null detail',
      {
        status: 'verified',
        summary: 'Done.',
        verification: { state: 'verified', method: 'agent:check', detail: null },
      },
    ],
    [
      'array status',
      {
        status: ['failed'],
        summary: 'Failed.',
        verification: { state: 'unverified', method: 'agent:check' },
      },
    ],
    [
      'array verification state',
      {
        status: 'failed',
        summary: 'Failed.',
        verification: { state: ['unverified'], method: 'agent:check' },
      },
    ],
  ])('fails closed on a structured result with %s', async (_name, payload) => {
    const { adapter } = adapterWith(() => jsonResponse(completion(JSON.stringify(payload))));
    const result = await adapter.run(request, context());
    expect(result.status).toBe('failed');
    expect(result.code).toBe('invalid');
    expect(result.verification.state).toBe('unverified');
  });

  it('preserves an explicit structured unavailable result without promoting it', async () => {
    const payload = JSON.stringify({
      status: 'unavailable',
      summary: 'The action service is unavailable.',
      verification: { state: 'unverified', method: 'agent:service-check' },
    });
    const { adapter } = adapterWith(() => jsonResponse(completion(payload)));
    const result = await adapter.run(request, context());
    expect(result.status).toBe('unavailable');
    expect(result.summary).toBe('The action service is unavailable.');
    expect(result.verification.state).toBe('unverified');
    expect(result.retryable).toBe(true);
  });

  it.each([
    [500, 'unavailable'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [429, 'unavailable'],
    [401, 'failed'],
    [403, 'failed'],
    [400, 'failed'],
    [404, 'failed'],
  ] as const)('maps HTTP %i to %s without leaking the body', async (status, expected) => {
    const { adapter, logger } = adapterWith(
      () => new Response(`{"error":"upstream detail ${SECRET}"}`, { status }),
    );
    const result = await adapter.run(request, context());
    expect(result.status).toBe(expected);
    expect(result.verification.state).toBe('unverified');
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain('upstream detail');
    expect(logger.lines.join('\n')).not.toContain(SECRET);
    expect(logger.lines.join('\n')).not.toContain('upstream detail');
  });

  it('treats transport errors as unavailable and logs only the error class', async () => {
    const { adapter, logger } = adapterWith(() => {
      throw new TypeError(`connect ECONNREFUSED 127.0.0.1:8642 ${SECRET}`);
    });
    const result = await adapter.run(request, context());
    expect(result.status).toBe('unavailable');
    expect(result.retryable).toBe(true);
    expect(JSON.stringify(result)).not.toContain('ECONNREFUSED');
    expect(logger.lines.some((line) => line.includes('TypeError'))).toBe(true);
    expect(logger.lines.join('\n')).not.toContain(SECRET);
    expect(logger.lines.join('\n')).not.toContain('ECONNREFUSED');
  });

  it('fails closed on oversized responses, declared or streamed', async () => {
    const { adapter: first } = adapterWith(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(10 * 1024 * 1024) },
        }),
      { maxResponseBytes: 1024 },
    );
    const declaredResult = await first.run(request, context());
    expect(declaredResult.status).toBe('failed');
    expect(declaredResult.code).toBe('invalid');

    const { adapter: second } = adapterWith(
      () => new Response(JSON.stringify(completion('x'.repeat(5000))), { status: 200 }),
      { maxResponseBytes: 1024 },
    );
    const streamedResult = await second.run(request, context());
    expect(streamedResult.status).toBe('failed');
    expect(streamedResult.code).toBe('invalid');
  });

  it('fails on malformed or empty completions', async () => {
    const { adapter: first } = adapterWith(() => new Response('not json', { status: 200 }));
    expect((await first.run(request, context())).status).toBe('failed');

    const { adapter: second } = adapterWith(() => jsonResponse(completion('   ')));
    expect((await second.run(request, context())).status).toBe('failed');

    const { adapter: third } = adapterWith(() => jsonResponse({ choices: [] }));
    expect((await third.run(request, context())).status).toBe('failed');
  });

  it.each([null, 'not-an-object'])(
    'fails closed when the completion message is %j',
    async (message) => {
      const { adapter } = adapterWith(() =>
        jsonResponse({ choices: [{ message, finish_reason: 'stop' }] }),
      );
      const result = await adapter.run(request, context());
      expect(result.status).toBe('failed');
      expect(result.verification.state).toBe('unverified');
    },
  );

  it('fails closed on deeply nested inner JSON', async () => {
    const nested = '['.repeat(2000) + ']'.repeat(2000);
    const { adapter } = adapterWith(() => jsonResponse(completion(nested)));
    const result = await adapter.run(request, context());
    expect(result.status).toBe('failed');
    expect(result.code).toBe('invalid');
    expect(result.verification.state).toBe('unverified');
  });

  it('reports cancelled when the action signal aborts the request', async () => {
    const controller = new AbortController();
    const { adapter } = adapterWith(
      (_url, init) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = adapter.run(request, context(controller.signal));
    controller.abort();
    const result = await pending;
    expect(result.status).toBe('cancelled');
  });

  it('refuses non-http endpoints at construction', () => {
    expect(
      () => new OpenAiHttpAdapter({ endpoint: 'ftp://agent.local/v1', model: 'm', fetch }),
    ).toThrow(/http/);
    expect(() => new OpenAiHttpAdapter({ endpoint: 'not a url', model: 'm', fetch })).toThrow();
  });

  it('never verifies a truncated completion', async () => {
    const { adapter } = adapterWith(() =>
      jsonResponse(completion(verifiedResult('Partial answer'), 'length')),
    );
    const result = await adapter.run(request, context());
    expect(result.status).toBe('failed');
    expect(result.verification.state).toBe('unverified');
  });
});
