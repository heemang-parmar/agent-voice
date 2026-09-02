import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { LIMITS, parseEvent } from '../src/index.js';

const valid = {
  v: 1,
  id: 'evt_01',
  ts: '2026-01-01T00:00:00.000Z',
  conversationId: 'conv_01',
  type: 'conversation.started',
  agentName: 'agent-voice',
  adapter: 'openai-http',
};

describe('envelope validation', () => {
  it('rejects malformed JSON as invalid_json', () => {
    expect(parseEvent('{not json')).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects non-object payloads as invalid_event', () => {
    for (const payload of ['[]', '"text"', '42', 'null']) {
      const result = parseEvent(payload);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalid_event');
    }
  });

  it('rejects oversized strings and byte arrays before parsing them', () => {
    const padding = 'x'.repeat(LIMITS.maxEventBytes);
    const oversized = JSON.stringify({ ...valid, agentName: padding });
    expect(parseEvent(oversized)).toMatchObject({ ok: false, reason: 'too_large' });
    expect(parseEvent(new TextEncoder().encode(oversized))).toMatchObject({
      ok: false,
      reason: 'too_large',
    });
  });

  it('accepts UTF-8 byte arrays and ArrayBuffers', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(valid));
    expect(parseEvent(bytes).ok).toBe(true);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    expect(parseEvent(buffer).ok).toBe(true);
  });

  it('accepts byte arrays created in another realm (iframes, workers, jsdom)', () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(valid)));
    const foreign = runInNewContext('new Uint8Array(bytes)', { bytes }) as Uint8Array;
    expect(foreign instanceof Uint8Array).toBe(false);
    expect(parseEvent(foreign).ok).toBe(true);
    const foreignBuffer = runInNewContext('new ArrayBuffer(0)', {}) as ArrayBuffer;
    expect(parseEvent(foreignBuffer)).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('rejects invalid UTF-8 as invalid_json', () => {
    expect(parseEvent(new Uint8Array([0xff, 0xfe, 0x7b]))).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });

  it('rejects unsupported protocol versions before anything else', () => {
    expect(parseEvent(JSON.stringify({ ...valid, v: 2 }))).toEqual({
      ok: false,
      reason: 'unsupported_version',
      version: 2,
    });
    expect(parseEvent(JSON.stringify({ ...valid, v: '1' }))).toEqual({
      ok: false,
      reason: 'unsupported_version',
      version: null,
    });
    expect(parseEvent(JSON.stringify({ type: 'conversation.started' }))).toEqual({
      ok: false,
      reason: 'unsupported_version',
      version: null,
    });
  });

  it('rejects malformed ids, timestamps, and missing conversation ids with bounded issues', () => {
    const cases: Record<string, unknown>[] = [
      { ...valid, id: '' },
      { ...valid, id: 'has spaces' },
      { ...valid, id: 'x'.repeat(LIMITS.maxIdChars + 1) },
      { ...valid, ts: 'yesterday' },
      { ...valid, ts: '2026-01-01T00:00:00' },
      { ...valid, conversationId: undefined },
      { ...valid, type: '' },
    ];
    for (const payload of cases) {
      const result = parseEvent(JSON.stringify(payload));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('invalid_event');
      if (result.reason !== 'invalid_event') return;
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.length).toBeLessThanOrEqual(10);
      for (const issue of result.issues) expect(issue.length).toBeLessThanOrEqual(200);
    }
  });

  it('rejects unknown extra fields on a known event', () => {
    const result = parseEvent(
      JSON.stringify({ ...valid, __proto__: { polluted: true }, extra: 1 }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_event' });
  });
});
