import 'server-only';

import { z } from 'zod';

import { DEFAULT_ALLOWED_ORIGINS, loadWebConfig, type ConfigResult } from './env';
import type { MintTokenInput } from './livekit-token';
import { checkSameOrigin } from './origin';
import type { RateLimiter } from './rate-limit';

export type { MintTokenInput } from './livekit-token';

/** The request body carries no parameters; anything else is refused. */
export const MAX_BODY_BYTES = 1024;

export interface ConnectionDetailsDeps {
  loadConfig: () => ConfigResult;
  mintToken: (input: MintTokenInput) => Promise<string>;
  /** Cryptographically random identifier with the given prefix. */
  randomId: (prefix: string) => string;
  clientLimiter: RateLimiter;
  globalLimiter: RateLimiter;
  now: () => number;
  /** Structured, redaction-safe logging: event names and scalar fields only. */
  log?: (event: string, fields?: Record<string, string | number>) => void;
}

export interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantIdentity: string;
  participantToken: string;
  agentName: string;
  expiresAt: string;
}

const bodySchema = z.object({}).strict();

const MAX_CLIENT_KEY_CHARS = 64;

function respond(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      vary: 'Origin',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

/** Best-effort client key for the per-client limiter. Spoofable, hence the global limiter too. */
function clientKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  const key = first && first.length > 0 ? first : (request.headers.get('x-real-ip') ?? 'unknown');
  return key.slice(0, MAX_CLIENT_KEY_CHARS);
}

/** Reads at most `maxBytes`; returns null (and stops reading) when the body is larger. */
async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length > maxBytes) return null;
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function allowedOriginsFor(config: ConfigResult): readonly string[] {
  return config.ok ? config.config.allowedOrigins : config.allowedOrigins;
}

/**
 * Framework-neutral handler for the token route. Every decision is made in
 * this order: method, rate limit, origin, configuration, body, mint. Errors
 * are generic and never include values from the environment or the request.
 */
export async function handleConnectionDetails(
  request: Request,
  deps: ConnectionDetailsDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return respond(405, { error: 'method_not_allowed' }, { allow: 'POST' });
  }

  // Per-client first so one noisy client cannot drain the shared budget.
  const client = deps.clientLimiter.check(clientKey(request));
  if (!client.allowed) {
    return respond(
      429,
      { error: 'rate_limited' },
      { 'retry-after': String(client.retryAfterSeconds) },
    );
  }
  const global = deps.globalLimiter.check('global');
  if (!global.allowed) {
    return respond(
      429,
      { error: 'rate_limited' },
      { 'retry-after': String(global.retryAfterSeconds) },
    );
  }

  const config = deps.loadConfig();
  const origin = checkSameOrigin(request.headers, allowedOriginsFor(config));
  if (!origin.ok) {
    deps.log?.('connection_details.origin_rejected', { reason: origin.reason });
    return respond(403, { error: 'forbidden' });
  }

  if (!config.ok) {
    return respond(503, {
      error: 'not_configured',
      missing: config.missing,
      invalid: config.invalid,
    });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(\s*;.*)?$/i.test(contentType.trim())) {
    return respond(415, { error: 'unsupported_media_type' });
  }
  const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  if (bytes === null) {
    return respond(413, { error: 'payload_too_large' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return respond(400, { error: 'invalid_request' });
  }
  if (!bodySchema.safeParse(parsed).success) {
    return respond(400, { error: 'invalid_request' });
  }

  const roomName = deps.randomId('room');
  const identity = deps.randomId('user');
  const { livekitUrl, apiKey, apiSecret, agentName, tokenTtlSeconds } = config.config;

  let participantToken: string;
  try {
    participantToken = await deps.mintToken({
      apiKey,
      apiSecret,
      identity,
      roomName,
      ttlSeconds: tokenTtlSeconds,
      agentName,
    });
  } catch (error) {
    deps.log?.('connection_details.mint_failed', {
      error: error instanceof Error ? error.name : typeof error,
    });
    return respond(500, { error: 'internal' });
  }

  const details: ConnectionDetails = {
    serverUrl: livekitUrl,
    roomName,
    participantIdentity: identity,
    participantToken,
    agentName,
    expiresAt: new Date(deps.now() + tokenTtlSeconds * 1000).toISOString(),
  };
  return respond(200, details);
}

export { DEFAULT_ALLOWED_ORIGINS, loadWebConfig };
