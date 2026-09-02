import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EVENT_TYPES, parseCommand, parseEvent } from '../src/index.js';

function readDir(name: string): { file: string; json: unknown }[] {
  const dir = fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));
  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => ({ file, json: JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as unknown }));
}

describe('fixture conformance', () => {
  const events = readDir('events');
  const commands = readDir('commands');
  const invalid = readDir('invalid');

  it('ships exactly one valid fixture per event type', () => {
    const stems = events.map((entry) => entry.file.replace(/\.json$/, '')).sort();
    expect(stems).toEqual([...EVENT_TYPES].sort());
  });

  it.each(events)('parses valid event fixture $file', ({ file, json }) => {
    const result = parseEvent(json);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.type).toBe(file.replace(/\.json$/, ''));
    // Round-trips through text as well as through decoded objects.
    expect(parseEvent(JSON.stringify(json))).toEqual(result);
  });

  it.each(commands)('parses valid command fixture $file', ({ file, json }) => {
    const result = parseCommand(json);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.value.type).toBe(file.replace(/\.json$/, ''));
  });

  it.each(invalid)('rejects invalid fixture $file with the declared reason', ({ json }) => {
    const { expect: reason, message } = json as { expect: string; message: unknown };
    const result = parseEvent(message);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe(reason);
  });

  it('never accepts an event fixture as a command or vice versa', () => {
    for (const { json } of events) expect(parseCommand(json).ok).toBe(false);
    for (const { json } of commands) expect(parseEvent(json).ok).toBe(false);
  });
});
