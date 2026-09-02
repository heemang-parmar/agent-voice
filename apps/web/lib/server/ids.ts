import 'server-only';

import { randomBytes } from 'node:crypto';

const PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;

/**
 * `prefix_` followed by 128 bits of CSPRNG output in base64url. The result
 * satisfies the protocol identifier grammar and stays well under its length
 * limit; room names and participant identities are never derived from
 * anything the client sent.
 */
export function randomId(prefix: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error('identifier prefix must be a short alphanumeric label');
  }
  return `${prefix}_${randomBytes(16).toString('base64url')}`;
}
