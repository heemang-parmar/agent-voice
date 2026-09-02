#!/usr/bin/env node
// Reports which configuration variables are present or missing, by NAME only.
// Values are never read into the output. Exit code is 0 unless --strict is
// given, in which case any missing required variable exits 1.
//
// Usage: node scripts/check-env.mjs [--strict] [--component web|worker|all] [--json]

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = {
  web: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
  worker: ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
};

const REALTIME_PROVIDERS = new Set(['openai-realtime', 'livekit-inference']);
const REALTIME_MODELS = {
  'openai-realtime': new Set([
    'gpt-realtime',
    'gpt-4o-realtime-preview',
    'gpt-4o-mini-realtime-preview',
  ]),
  'livekit-inference': new Set(['openai/gpt-4o-mini']),
};
const REALTIME_VOICES = {
  'openai-realtime': new Set([
    'alloy',
    'ash',
    'ballad',
    'cedar',
    'coral',
    'echo',
    'marin',
    'sage',
    'shimmer',
    'verse',
  ]),
  'livekit-inference': new Set(['rigel']),
};
const REALTIME_DEFAULTS = {
  'openai-realtime': { model: 'gpt-realtime', voice: 'marin' },
  'livekit-inference': { model: 'openai/gpt-4o-mini', voice: 'rigel' },
};
const ADAPTERS = new Set(['openai-http', 'none']);
const AGENT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEFAULT_AGENT_NAME = 'agent-voice';
const MAX_SESSION_KEY_CHARS = 200;

const OPTIONAL = {
  web: ['AGENT_VOICE_AGENT_NAME', 'AGENT_VOICE_ALLOWED_ORIGINS', 'AGENT_VOICE_TOKEN_TTL_SECONDS'],
  worker: [
    'AGENT_VOICE_REALTIME_PROVIDER',
    'OPENAI_API_KEY',
    'AGENT_VOICE_AGENT_ENDPOINT',
    'AGENT_VOICE_AGENT_NAME',
    'AGENT_VOICE_ADAPTER',
    'AGENT_VOICE_REALTIME_MODEL',
    'AGENT_VOICE_REALTIME_VOICE',
    'AGENT_VOICE_AGENT_API_KEY',
    'AGENT_VOICE_AGENT_MODEL',
    'AGENT_VOICE_SESSION_KEY',
    'AGENT_VOICE_AGENT_TIMEOUT_SECONDS',
  ],
};

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const json = args.includes('--json');
const componentIndex = args.indexOf('--component');
const component = componentIndex === -1 ? 'all' : (args[componentIndex + 1] ?? 'all');

// Merge a root .env file (if present) without exporting or printing values.
function loadDotEnv(path) {
  const found = {};
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return found;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) found[key] = value;
  }
  return found;
}

const fileEnv = loadDotEnv(resolve(process.cwd(), '.env'));
const rawValueOf = (name) => process.env[name] ?? fileEnv[name];
const valueOf = (name) => {
  const value = rawValueOf(name);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
const isSet = (name) => {
  return valueOf(name) !== undefined;
};
const isUrl = (value, schemes) => {
  try {
    const parsed = new URL(value);
    return (
      schemes.has(parsed.protocol.slice(0, -1)) &&
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
};

const components = component === 'all' ? ['web', 'worker'] : [component];
const report = {};
let anyProblem = false;
for (const name of components) {
  if (!(name in REQUIRED)) {
    console.error(`unknown component: ${name} (expected web, worker or all)`);
    process.exit(2);
  }
  const required = [...REQUIRED[name]];
  const invalid = [];
  if (name === 'worker') {
    const realtimeProvider = valueOf('AGENT_VOICE_REALTIME_PROVIDER') ?? 'openai-realtime';
    if (!REALTIME_PROVIDERS.has(realtimeProvider)) {
      invalid.push('AGENT_VOICE_REALTIME_PROVIDER');
    }
    if (realtimeProvider !== 'livekit-inference') required.push('OPENAI_API_KEY');

    const providerForDefaults =
      realtimeProvider === 'livekit-inference' ? 'livekit-inference' : 'openai-realtime';
    const realtimeModel =
      valueOf('AGENT_VOICE_REALTIME_MODEL') ?? REALTIME_DEFAULTS[providerForDefaults].model;
    const realtimeVoice =
      valueOf('AGENT_VOICE_REALTIME_VOICE') ?? REALTIME_DEFAULTS[providerForDefaults].voice;
    if (!REALTIME_MODELS[providerForDefaults].has(realtimeModel)) {
      invalid.push('AGENT_VOICE_REALTIME_MODEL');
    }
    if (!REALTIME_VOICES[providerForDefaults].has(realtimeVoice)) {
      invalid.push('AGENT_VOICE_REALTIME_VOICE');
    }

    const adapter = valueOf('AGENT_VOICE_ADAPTER') ?? 'openai-http';
    if (!ADAPTERS.has(adapter)) invalid.push('AGENT_VOICE_ADAPTER');
    if (adapter === 'openai-http') required.push('AGENT_VOICE_AGENT_ENDPOINT');

    const agentEndpoint = valueOf('AGENT_VOICE_AGENT_ENDPOINT');
    if (
      adapter === 'openai-http' &&
      agentEndpoint !== undefined &&
      !isUrl(agentEndpoint, new Set(['http', 'https']))
    ) {
      invalid.push('AGENT_VOICE_AGENT_ENDPOINT');
    }

    const rawSessionKey = rawValueOf('AGENT_VOICE_SESSION_KEY');
    const sessionKey = valueOf('AGENT_VOICE_SESSION_KEY');
    if (
      rawSessionKey !== undefined &&
      (sessionKey === undefined || sessionKey.length > MAX_SESSION_KEY_CHARS)
    ) {
      invalid.push('AGENT_VOICE_SESSION_KEY');
    }

    const timeout = valueOf('AGENT_VOICE_AGENT_TIMEOUT_SECONDS');
    if (timeout !== undefined) {
      const timeoutValue = /^-?\d{1,9}$/.test(timeout) ? Number(timeout) : Number.NaN;
      if (!Number.isInteger(timeoutValue) || timeoutValue < 1 || timeoutValue > 120) {
        invalid.push('AGENT_VOICE_AGENT_TIMEOUT_SECONDS');
      }
    }

    const agentName = valueOf('AGENT_VOICE_AGENT_NAME') ?? DEFAULT_AGENT_NAME;
    if (!AGENT_NAME_PATTERN.test(agentName)) invalid.push('AGENT_VOICE_AGENT_NAME');
  }
  const missing = required.filter((key) => !isSet(key));
  const livekitUrl = valueOf('LIVEKIT_URL');
  if (livekitUrl !== undefined && !isUrl(livekitUrl, new Set(['ws', 'wss', 'http', 'https']))) {
    invalid.push('LIVEKIT_URL');
  }
  const present = required.filter((key) => isSet(key));
  const optionalSet = OPTIONAL[name].filter((key) => !required.includes(key) && isSet(key));
  report[name] = {
    ready: missing.length === 0 && invalid.length === 0,
    present,
    missing,
    invalid,
    optionalSet,
  };
  if (missing.length > 0 || invalid.length > 0) anyProblem = true;
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [name, entry] of Object.entries(report)) {
    console.log(`${name}: ${entry.ready ? 'ready' : 'not configured'}`);
    if (entry.present.length > 0) console.log(`  present : ${entry.present.join(', ')}`);
    if (entry.missing.length > 0) console.log(`  missing : ${entry.missing.join(', ')}`);
    if (entry.invalid.length > 0) console.log(`  invalid : ${entry.invalid.join(', ')}`);
    if (entry.optionalSet.length > 0) console.log(`  optional: ${entry.optionalSet.join(', ')}`);
  }
  if (anyProblem) {
    console.log('');
    console.log(
      'Copy .env.example to .env and fill in the missing names above (values are never printed).',
    );
  }
}

process.exit(strict && anyProblem ? 1 : 0);
