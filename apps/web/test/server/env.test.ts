// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { WEB_REQUIRED_ENV, loadWebConfig } from '@/lib/server/env';

const complete = {
  LIVEKIT_URL: 'wss://livekit.example.test',
  LIVEKIT_API_KEY: 'key-for-tests',
  LIVEKIT_API_SECRET: 'secret-for-tests',
};

describe('loadWebConfig', () => {
  it('lists the required variable names', () => {
    expect(WEB_REQUIRED_ENV).toEqual(['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET']);
  });

  it('reports every missing required variable by name only', () => {
    const result = loadWebConfig({ LIVEKIT_URL: 'wss://livekit.example.test' });
    expect(result).toEqual({
      ok: false,
      missing: ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
      invalid: [],
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
  });

  it('treats blank values as missing', () => {
    const result = loadWebConfig({ ...complete, LIVEKIT_API_SECRET: '   ' });
    expect(result).toMatchObject({ ok: false, missing: ['LIVEKIT_API_SECRET'] });
  });

  it('applies safe defaults for the optional variables', () => {
    const result = loadWebConfig(complete);
    expect(result).toEqual({
      ok: true,
      config: {
        livekitUrl: 'wss://livekit.example.test',
        apiKey: 'key-for-tests',
        apiSecret: 'secret-for-tests',
        agentName: 'agent-voice',
        allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
        tokenTtlSeconds: 600,
      },
    });
  });

  it('parses the optional variables', () => {
    const result = loadWebConfig({
      ...complete,
      AGENT_VOICE_AGENT_NAME: 'voice-worker.prod',
      AGENT_VOICE_ALLOWED_ORIGINS: ' https://voice.example.test , http://localhost:3000 ',
      AGENT_VOICE_TOKEN_TTL_SECONDS: '300',
    });
    expect(result).toMatchObject({
      ok: true,
      config: {
        agentName: 'voice-worker.prod',
        allowedOrigins: ['https://voice.example.test', 'http://localhost:3000'],
        tokenTtlSeconds: 300,
      },
    });
  });

  it('rejects invalid values by name, never by value', () => {
    const result = loadWebConfig({
      ...complete,
      LIVEKIT_URL: 'ftp://not-a-livekit-url',
      AGENT_VOICE_AGENT_NAME: 'bad name!',
      AGENT_VOICE_ALLOWED_ORIGINS: 'https://voice.example.test/path',
      AGENT_VOICE_TOKEN_TTL_SECONDS: '5000',
    });
    expect(result).toEqual({
      ok: false,
      missing: [],
      invalid: [
        'LIVEKIT_URL',
        'AGENT_VOICE_AGENT_NAME',
        'AGENT_VOICE_ALLOWED_ORIGINS',
        'AGENT_VOICE_TOKEN_TTL_SECONDS',
      ],
      // An unusable allowlist falls back to the local defaults.
      allowedOrigins: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    });
    expect(JSON.stringify(result)).not.toContain('not-a-livekit-url');
  });

  it('rejects an allowlist entry that is not an exact origin', () => {
    for (const bad of ['localhost:3000', 'https://voice.example.test/', 'null', '*']) {
      const result = loadWebConfig({ ...complete, AGENT_VOICE_ALLOWED_ORIGINS: bad });
      expect(result, bad).toMatchObject({ ok: false, invalid: ['AGENT_VOICE_ALLOWED_ORIGINS'] });
    }
  });

  it('bounds the token lifetime to 60–900 seconds', () => {
    expect(loadWebConfig({ ...complete, AGENT_VOICE_TOKEN_TTL_SECONDS: '59' })).toMatchObject({
      ok: false,
      invalid: ['AGENT_VOICE_TOKEN_TTL_SECONDS'],
    });
    expect(loadWebConfig({ ...complete, AGENT_VOICE_TOKEN_TTL_SECONDS: '901' })).toMatchObject({
      ok: false,
      invalid: ['AGENT_VOICE_TOKEN_TTL_SECONDS'],
    });
    expect(loadWebConfig({ ...complete, AGENT_VOICE_TOKEN_TTL_SECONDS: '60' })).toMatchObject({
      ok: true,
      config: { tokenTtlSeconds: 60 },
    });
  });
});
