// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { checkSameOrigin } from '@/lib/server/origin';

const allowed = ['http://localhost:3000', 'https://voice.example.test'];

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('checkSameOrigin', () => {
  it('accepts an exact allowlisted origin', () => {
    expect(checkSameOrigin(headers({ origin: 'https://voice.example.test' }), allowed)).toEqual({
      ok: true,
      origin: 'https://voice.example.test',
    });
  });

  it('rejects a missing origin', () => {
    expect(checkSameOrigin(headers({}), allowed)).toEqual({ ok: false, reason: 'missing_origin' });
  });

  it('rejects malformed and opaque origins', () => {
    for (const bad of ['null', 'voice.example.test', 'https://', 'javascript:alert(1)']) {
      expect(checkSameOrigin(headers({ origin: bad }), allowed), bad).toEqual({
        ok: false,
        reason: 'malformed_origin',
      });
    }
  });

  it('rejects cross-origin, subdomain, port and scheme variations', () => {
    for (const bad of [
      'https://evil.example.test',
      'https://voice.example.test.evil.test',
      'https://sub.voice.example.test',
      'http://voice.example.test',
      'https://voice.example.test:8443',
      'http://localhost:3001',
    ]) {
      expect(checkSameOrigin(headers({ origin: bad }), allowed), bad).toEqual({
        ok: false,
        reason: 'origin_not_allowed',
      });
    }
  });

  it('rejects an origin carrying a path or trailing slash', () => {
    expect(checkSameOrigin(headers({ origin: 'https://voice.example.test/' }), allowed)).toEqual({
      ok: false,
      reason: 'malformed_origin',
    });
  });

  it('cross-checks Fetch Metadata when the browser sends it', () => {
    const base = { origin: 'https://voice.example.test' };
    expect(
      checkSameOrigin(
        headers({ ...base, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' }),
        allowed,
      ),
    ).toMatchObject({ ok: true });
    expect(
      checkSameOrigin(
        headers({ ...base, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'same-origin' }),
        allowed,
      ),
    ).toMatchObject({ ok: true });
    for (const site of ['cross-site', 'same-site', 'none']) {
      expect(checkSameOrigin(headers({ ...base, 'sec-fetch-site': site }), allowed), site).toEqual({
        ok: false,
        reason: 'fetch_metadata_mismatch',
      });
    }
    for (const mode of ['navigate', 'no-cors', 'websocket']) {
      expect(checkSameOrigin(headers({ ...base, 'sec-fetch-mode': mode }), allowed), mode).toEqual({
        ok: false,
        reason: 'fetch_metadata_mismatch',
      });
    }
    expect(checkSameOrigin(headers({ ...base, 'sec-fetch-dest': 'document' }), allowed)).toEqual({
      ok: false,
      reason: 'fetch_metadata_mismatch',
    });
  });

  it('is case-insensitive on the header name but exact on the value', () => {
    expect(
      checkSameOrigin(headers({ Origin: 'https://voice.example.test' }), allowed),
    ).toMatchObject({
      ok: true,
    });
    // Browsers send lower-case hosts; anything else is not a browser Origin.
    expect(checkSameOrigin(headers({ origin: 'https://VOICE.example.test' }), allowed)).toEqual({
      ok: false,
      reason: 'malformed_origin',
    });
  });
});
