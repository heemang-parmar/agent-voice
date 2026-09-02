import { describe, expect, it } from 'vitest';

import { parseEvent } from '../src/index.js';

const started = {
  v: 1,
  id: 'evt_01',
  ts: '2026-01-01T00:00:00.000Z',
  conversationId: 'conv_01',
  type: 'conversation.started',
  agentName: 'agent-voice',
  adapter: 'openai-http',
};

describe('parseEvent', () => {
  it('accepts a valid conversation.started envelope', () => {
    const result = parseEvent(JSON.stringify(started));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('conversation.started');
    expect(result.value.conversationId).toBe('conv_01');
  });

  it('reports an unknown event type without throwing', () => {
    const result = parseEvent(JSON.stringify({ ...started, type: 'something.new' }));
    expect(result).toEqual({ ok: false, reason: 'unknown_event', type: 'something.new' });
  });
});
