/**
 * Typed access to the canonical protocol fixtures. The JSON files under
 * `fixtures/` are the source of truth (shared with the Python worker); this
 * module re-exports them as validated, typed values for UI demos and tests.
 */
import { commands, events, invalid, scenarios as rawScenarios } from './fixtures.generated.js';
import type { AgentVoiceCommand, AgentVoiceEvent, EventType, ParseFailure } from './index.js';
import { parseCommand, parseEvent } from './index.js';

function mustParseEvent(value: unknown, label: string): AgentVoiceEvent {
  const result = parseEvent(value);
  if (!result.ok) throw new Error(`fixture ${label} is not a valid event: ${result.reason}`);
  return result.value;
}

function mustParseCommand(value: unknown, label: string): AgentVoiceCommand {
  const result = parseCommand(value);
  if (!result.ok) throw new Error(`fixture ${label} is not a valid command: ${result.reason}`);
  return result.value;
}

export const eventFixtures = Object.fromEntries(
  Object.entries(events).map(([type, value]) => [type, mustParseEvent(value, type)]),
) as Record<EventType, AgentVoiceEvent>;

export const commandFixtures = Object.fromEntries(
  Object.entries(commands).map(([type, value]) => [type, mustParseCommand(value, type)]),
) as Record<keyof typeof commands, AgentVoiceCommand>;

export interface InvalidFixture {
  expect: ParseFailure['reason'];
  note?: string;
  message: unknown;
}

export const invalidFixtures: Record<keyof typeof invalid, InvalidFixture> = invalid;

export interface ScenarioFixture {
  name: string;
  description: string;
  events: AgentVoiceEvent[];
}

export const scenarios = Object.fromEntries(
  Object.entries(rawScenarios).map(([name, scenario]) => [
    name,
    {
      name: scenario.name,
      description: scenario.description,
      events: scenario.events.map((event, index) => mustParseEvent(event, `${name}[${index}]`)),
    },
  ]),
) as Record<keyof typeof rawScenarios, ScenarioFixture>;

export type ScenarioName = keyof typeof rawScenarios;
export const SCENARIO_NAMES = Object.keys(rawScenarios) as ScenarioName[];
