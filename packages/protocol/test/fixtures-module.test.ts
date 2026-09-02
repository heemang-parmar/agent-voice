import { describe, expect, it } from 'vitest';

import { commandFixtures, eventFixtures, scenarios } from '../src/fixtures.js';
import { EVENT_TYPES, parseCommand, parseEvent } from '../src/index.js';

describe('fixtures module', () => {
  it('exposes one parsed event fixture per event type', () => {
    expect(Object.keys(eventFixtures).sort()).toEqual([...EVENT_TYPES].sort());
    for (const type of EVENT_TYPES) {
      const fixture = eventFixtures[type];
      expect(fixture.type).toBe(type);
      expect(parseEvent(fixture)).toEqual({ ok: true, value: fixture });
    }
  });

  it('exposes parsed command fixtures', () => {
    for (const command of Object.values(commandFixtures)) {
      expect(parseCommand(command)).toEqual({ ok: true, value: command });
    }
  });

  it('ships a chronological delegation scenario covering the action lifecycle', () => {
    const events = scenarios.delegation.events;
    expect(events.length).toBeGreaterThan(8);
    let previous = 0;
    for (const event of events) {
      expect(parseEvent(event).ok).toBe(true);
      const time = Date.parse(event.ts);
      expect(time).toBeGreaterThanOrEqual(previous);
      previous = time;
    }
    const types = events.map((event) => event.type);
    expect(types[0]).toBe('conversation.started');
    for (const required of [
      'user.transcript.final',
      'action.started',
      'action.progress',
      'approval.requested',
      'approval.resolved',
      'artifact.created',
      'action.verified',
      'agent.message.final',
    ]) {
      expect(types).toContain(required);
    }
  });

  it('ships a failure scenario that ends in action.failed without an approval', () => {
    const types = scenarios.failure.events.map((event) => event.type);
    expect(types).toContain('action.failed');
    expect(types).not.toContain('action.verified');
  });
});

describe('generated fixtures stay in sync with the JSON files', () => {
  it('matches fixtures/**/*.json exactly', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const generated = await import('../src/fixtures.generated.js');
    for (const dir of ['events', 'commands', 'invalid', 'scenarios'] as const) {
      const path = fileURLToPath(new URL(`../fixtures/${dir}/`, import.meta.url));
      const fromDisk = Object.fromEntries(
        readdirSync(path)
          .filter((file) => file.endsWith('.json'))
          .map((file) => [
            file.replace(/\.json$/, ''),
            JSON.parse(readFileSync(`${path}${file}`, 'utf8')) as unknown,
          ]),
      );
      expect(generated[dir]).toEqual(fromDisk);
    }
  });
});
