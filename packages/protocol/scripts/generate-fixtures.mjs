#!/usr/bin/env node
// Regenerates src/fixtures.generated.ts from the JSON files under fixtures/.
// The JSON files are the canonical, language-neutral fixtures (the Python
// worker reads them directly); the generated module lets TypeScript consumers
// import them without JSON loaders and keeps the published dist self-contained.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturesDir = join(root, 'fixtures');
const target = join(root, 'src', 'fixtures.generated.ts');

function readJsonDir(name) {
  const dir = join(fixturesDir, name);
  const entries = {};
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    entries[file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  }
  return entries;
}

const generated = {
  events: readJsonDir('events'),
  commands: readJsonDir('commands'),
  invalid: readJsonDir('invalid'),
  scenarios: readJsonDir('scenarios'),
};

const banner = `// GENERATED FILE - do not edit by hand.
// Source: packages/protocol/fixtures/**/*.json
// Regenerate with: pnpm --filter @agent-voice/protocol generate:fixtures
`;

const body = Object.entries(generated)
  .map(([key, value]) => `export const ${key} = ${JSON.stringify(value, null, 2)} as const;\n`)
  .join('\n');

// Drift between the JSON files and this module is caught by
// test/fixtures-module.test.ts, which deep-compares the two.
writeFileSync(target, `${banner}\n${body}`);
process.stdout.write(`wrote ${target}\n`);
