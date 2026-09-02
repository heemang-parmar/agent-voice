import 'server-only';

/**
 * Server-side configuration for the web app. Values are read from the
 * environment once per request and never leave this module except as typed
 * config; failures are reported by variable NAME only so they can be shown
 * to a user or logged without leaking anything.
 */
export const WEB_REQUIRED_ENV = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'] as const;

export const WEB_OPTIONAL_ENV = [
  'AGENT_VOICE_AGENT_NAME',
  'AGENT_VOICE_ALLOWED_ORIGINS',
  'AGENT_VOICE_TOKEN_TTL_SECONDS',
] as const;

export const DEFAULT_AGENT_NAME = 'agent-voice';
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
export const DEFAULT_TOKEN_TTL_SECONDS = 600;
export const MIN_TOKEN_TTL_SECONDS = 60;
export const MAX_TOKEN_TTL_SECONDS = 900;

const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface WebConfig {
  livekitUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Fixed worker name used for explicit dispatch; never client-controlled. */
  agentName: string;
  /** Exact origins allowed to call the token route. */
  allowedOrigins: string[];
  tokenTtlSeconds: number;
}

export type ConfigResult =
  | { ok: true; config: WebConfig }
  | {
      ok: false;
      missing: string[];
      invalid: string[];
      /** Still needed while unconfigured so the 503 is only served same-origin. */
      allowedOrigins: string[];
    };

type Env = Record<string, string | undefined>;

function read(env: Env, name: string): string | undefined {
  const value = env[name];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isLiveKitUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return ['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) && url.hostname.length > 0;
}

/** An allowlist entry must be exactly what a browser sends as `Origin`. */
export function isExactOrigin(value: string): boolean {
  if (value.length === 0 || value.length > 253 + 16) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return url.origin === value;
}

function parseOrigins(raw: string): string[] | null {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return null;
  return entries.every(isExactOrigin) ? entries : null;
}

function parseTtl(raw: string): number | null {
  if (!/^\d{1,6}$/.test(raw)) return null;
  const value = Number(raw);
  if (value < MIN_TOKEN_TTL_SECONDS || value > MAX_TOKEN_TTL_SECONDS) return null;
  return value;
}

export function loadWebConfig(env: Env = process.env): ConfigResult {
  const missing = WEB_REQUIRED_ENV.filter((name) => read(env, name) === undefined);
  const invalid: string[] = [];

  const livekitUrl = read(env, 'LIVEKIT_URL');
  if (livekitUrl !== undefined && !isLiveKitUrl(livekitUrl)) invalid.push('LIVEKIT_URL');

  const rawAgentName = read(env, 'AGENT_VOICE_AGENT_NAME');
  const agentName = rawAgentName ?? DEFAULT_AGENT_NAME;
  if (!AGENT_NAME_PATTERN.test(agentName)) invalid.push('AGENT_VOICE_AGENT_NAME');

  const rawOrigins = read(env, 'AGENT_VOICE_ALLOWED_ORIGINS');
  const allowedOrigins =
    rawOrigins === undefined ? DEFAULT_ALLOWED_ORIGINS : parseOrigins(rawOrigins);
  if (allowedOrigins === null) invalid.push('AGENT_VOICE_ALLOWED_ORIGINS');

  const rawTtl = read(env, 'AGENT_VOICE_TOKEN_TTL_SECONDS');
  const tokenTtlSeconds = rawTtl === undefined ? DEFAULT_TOKEN_TTL_SECONDS : parseTtl(rawTtl);
  if (tokenTtlSeconds === null) invalid.push('AGENT_VOICE_TOKEN_TTL_SECONDS');

  const apiKey = read(env, 'LIVEKIT_API_KEY');
  const apiSecret = read(env, 'LIVEKIT_API_SECRET');

  if (
    missing.length > 0 ||
    invalid.length > 0 ||
    livekitUrl === undefined ||
    apiKey === undefined ||
    apiSecret === undefined ||
    allowedOrigins === null ||
    tokenTtlSeconds === null
  ) {
    return {
      ok: false,
      missing,
      invalid,
      allowedOrigins: [...(allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS)],
    };
  }

  return {
    ok: true,
    config: {
      livekitUrl,
      apiKey,
      apiSecret,
      agentName,
      allowedOrigins: [...allowedOrigins],
      tokenTtlSeconds,
    },
  };
}
