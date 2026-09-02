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
  worker: [
    'LIVEKIT_URL',
    'LIVEKIT_API_KEY',
    'LIVEKIT_API_SECRET',
    'OPENAI_API_KEY',
    'AGENT_VOICE_AGENT_ENDPOINT',
  ],
};

const OPTIONAL = {
  web: ['AGENT_VOICE_AGENT_NAME', 'AGENT_VOICE_ALLOWED_ORIGINS', 'AGENT_VOICE_TOKEN_TTL_SECONDS'],
  worker: [
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
const isSet = (name) => {
  const value = process.env[name] ?? fileEnv[name];
  return typeof value === 'string' && value.trim() !== '';
};

const components = component === 'all' ? ['web', 'worker'] : [component];
const report = {};
let anyMissing = false;
for (const name of components) {
  if (!(name in REQUIRED)) {
    console.error(`unknown component: ${name} (expected web, worker or all)`);
    process.exit(2);
  }
  const missing = REQUIRED[name].filter((key) => !isSet(key));
  const present = REQUIRED[name].filter((key) => isSet(key));
  const optionalSet = OPTIONAL[name].filter((key) => isSet(key));
  report[name] = { ready: missing.length === 0, present, missing, optionalSet };
  if (missing.length > 0) anyMissing = true;
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [name, entry] of Object.entries(report)) {
    console.log(`${name}: ${entry.ready ? 'ready' : 'not configured'}`);
    if (entry.present.length > 0) console.log(`  present : ${entry.present.join(', ')}`);
    if (entry.missing.length > 0) console.log(`  missing : ${entry.missing.join(', ')}`);
    if (entry.optionalSet.length > 0) console.log(`  optional: ${entry.optionalSet.join(', ')}`);
  }
  if (anyMissing) {
    console.log('');
    console.log(
      'Copy .env.example to .env and fill in the missing names above (values are never printed).',
    );
  }
}

process.exit(strict && anyMissing ? 1 : 0);
