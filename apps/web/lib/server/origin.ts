import 'server-only';

import { isExactOrigin } from './env';

export type OriginCheck =
  | { ok: true; origin: string }
  | {
      ok: false;
      reason:
        'missing_origin' | 'malformed_origin' | 'origin_not_allowed' | 'fetch_metadata_mismatch';
    };

const MAX_ORIGIN_CHARS = 512;

/**
 * Same-origin enforcement for the token route. The `Origin` header must be
 * present, well-formed, and exactly equal (scheme, host, port; no path) to one
 * of the configured origins. When the browser also sends Fetch Metadata, it
 * must describe a same-origin, non-navigation fetch; anything else is refused
 * even if `Origin` looks right.
 */
export function checkSameOrigin(headers: Headers, allowedOrigins: readonly string[]): OriginCheck {
  const origin = headers.get('origin');
  if (origin === null || origin.trim().length === 0) {
    return { ok: false, reason: 'missing_origin' };
  }
  if (origin.length > MAX_ORIGIN_CHARS || !isExactOrigin(origin)) {
    return { ok: false, reason: 'malformed_origin' };
  }
  if (!allowedOrigins.includes(origin)) {
    return { ok: false, reason: 'origin_not_allowed' };
  }

  const site = headers.get('sec-fetch-site');
  if (site !== null && site !== 'same-origin') {
    return { ok: false, reason: 'fetch_metadata_mismatch' };
  }
  const mode = headers.get('sec-fetch-mode');
  if (mode !== null && mode !== 'cors' && mode !== 'same-origin') {
    return { ok: false, reason: 'fetch_metadata_mismatch' };
  }
  const dest = headers.get('sec-fetch-dest');
  if (dest !== null && dest !== 'empty') {
    return { ok: false, reason: 'fetch_metadata_mismatch' };
  }

  return { ok: true, origin };
}
