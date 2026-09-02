import { describe, expect, it } from 'vitest';

import {
  LIMITS,
  ProtocolEncodeError,
  encodeCommand,
  encodeEvent,
  isSafeArtifactUrl,
  parseEvent,
  type AgentVoiceCommand,
  type AgentVoiceEvent,
} from '../src/index.js';

describe('isSafeArtifactUrl', () => {
  it.each([
    'https://example.com/run/1',
    'http://localhost:8080/report?id=3#top',
    'https://ci.example.com/a%20b',
  ])('accepts %s', (url) => {
    expect(isSafeArtifactUrl(url)).toBe(true);
  });

  it.each([
    '',
    'javascript:alert(1)',
    'data:text/html,<script>',
    'blob:https://example.com/uuid',
    'file:///etc/passwd',
    'ftp://example.com/file',
    '//example.com/protocol-relative',
    '/relative/path',
    'https://user:secret@example.com/',
    'https://user@example.com/',
    'https://example.com/with space',
    'https://example.com/\nnewline',
    `https://example.com/${'a'.repeat(LIMITS.maxUrlChars)}`,
  ])('rejects %j', (url) => {
    expect(isSafeArtifactUrl(url)).toBe(false);
  });
});

describe('encoding', () => {
  const verified: AgentVoiceEvent = {
    v: 1,
    id: 'evt_enc_1',
    ts: '2026-01-01T00:00:00.000Z',
    conversationId: 'conv_1',
    type: 'action.verified',
    actionId: 'act_1',
    summary: 'Done.',
    verification: { state: 'verified', method: 'test' },
  };

  it('round-trips a valid event through encodeEvent and parseEvent', () => {
    const text = encodeEvent(verified);
    expect(typeof text).toBe('string');
    expect(parseEvent(text)).toEqual({ ok: true, value: verified });
  });

  it('refuses to encode an event that fails validation', () => {
    const broken = { ...verified, actionId: 'bad id' } as AgentVoiceEvent;
    expect(() => encodeEvent(broken)).toThrow(ProtocolEncodeError);
    try {
      encodeEvent(broken);
    } catch (error) {
      expect((error as ProtocolEncodeError).failure.reason).toBe('invalid_event');
    }
  });

  it('refuses to encode an event that would exceed the byte budget', () => {
    const artifacts = Array.from({ length: 4 }, (_, index) => ({
      id: `art_${index}`,
      kind: 'text' as const,
      title: 'Big',
      text: 'y'.repeat(LIMITS.maxArtifactTextChars),
    }));
    const big: AgentVoiceEvent = { ...verified, artifacts };
    expect(() => encodeEvent(big)).toThrow(/bytes exceeds/);
  });

  it('encodes commands with the same checks', () => {
    const command: AgentVoiceCommand = {
      v: 1,
      id: 'cmd_1',
      ts: '2026-01-01T00:00:00.000Z',
      conversationId: 'conv_1',
      type: 'action.cancel',
      actionId: 'act_1',
    };
    expect(JSON.parse(encodeCommand(command))).toEqual(command);
    expect(() =>
      encodeCommand({ ...command, type: 'approval.respond' } as AgentVoiceCommand),
    ).toThrow(ProtocolEncodeError);
  });
});
