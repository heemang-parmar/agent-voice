import type { z } from 'zod';

import { commandSchemas, isCommandType, type AgentVoiceCommand } from './commands.js';
import { envelopeSchema } from './envelope.js';
import { eventSchemas, isEventType, type AgentVoiceEvent } from './events.js';
import { LIMITS, PROTOCOL_VERSION } from './limits.js';

export type ParseFailure =
  | { ok: false; reason: 'invalid_json' }
  | { ok: false; reason: 'too_large'; bytes: number }
  | { ok: false; reason: 'unsupported_version'; version: number | null }
  | { ok: false; reason: 'unknown_event'; type: string }
  | { ok: false; reason: 'invalid_event'; issues: string[] };

export type ParseResult<T> = { ok: true; value: T } | ParseFailure;

/** JSON text, UTF-8 bytes, or an already-decoded value. */
export type RawMessage = unknown;

const MAX_ISSUES = 10;
const MAX_ISSUE_CHARS = 200;
const MAX_TYPE_ECHO_CHARS = 64;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function utf8ByteLength(text: string): number {
  return textEncoder.encode(text).byteLength;
}

/** Formats zod issues into short, bounded, path-prefixed strings. */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path.map(String).join('.');
    const text = path ? `${path}: ${issue.message}` : issue.message;
    return text.length > MAX_ISSUE_CHARS ? `${text.slice(0, MAX_ISSUE_CHARS - 1)}…` : text;
  });
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  const tag = Object.prototype.toString.call(value);
  return tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]';
}

/**
 * Turns a raw payload (JSON text, UTF-8 bytes, or an already-decoded value)
 * into a plain value, enforcing the byte budget first.
 */
export function decodeRaw(input: RawMessage): ParseResult<unknown> {
  // Brand checks rather than `instanceof`: bytes that crossed a realm
  // boundary (iframe, worker, test DOM) are still bytes.
  if (isArrayBufferLike(input)) {
    input = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    input = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof Uint8Array) {
    if (input.byteLength > LIMITS.maxEventBytes) {
      return { ok: false, reason: 'too_large', bytes: input.byteLength };
    }
    try {
      input = textDecoder.decode(input);
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
  }
  if (typeof input === 'string') {
    const bytes = utf8ByteLength(input);
    if (bytes > LIMITS.maxEventBytes) {
      return { ok: false, reason: 'too_large', bytes };
    }
    try {
      return { ok: true, value: JSON.parse(input) as unknown };
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
  }
  return { ok: true, value: input };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the version and the shared envelope fields, in that order. */
export function checkEnvelope(value: unknown): ParseResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return { ok: false, reason: 'invalid_event', issues: ['payload must be a JSON object'] };
  }
  if (value.v !== PROTOCOL_VERSION) {
    const version = typeof value.v === 'number' ? value.v : null;
    return { ok: false, reason: 'unsupported_version', version };
  }
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { ok: false, reason: 'invalid_event', issues: formatIssues(envelope.error) };
  }
  return { ok: true, value };
}

function parseMessage<T>(
  input: RawMessage,
  isKnown: (type: string) => boolean,
  schemaFor: (type: string) => z.ZodType<T>,
): ParseResult<T> {
  const decoded = decodeRaw(input);
  if (!decoded.ok) return decoded;
  const envelope = checkEnvelope(decoded.value);
  if (!envelope.ok) return envelope;

  const type = String(envelope.value.type);
  if (!isKnown(type)) {
    return { ok: false, reason: 'unknown_event', type: type.slice(0, MAX_TYPE_ECHO_CHARS) };
  }
  const result = schemaFor(type).safeParse(envelope.value);
  if (!result.success) {
    return { ok: false, reason: 'invalid_event', issues: formatIssues(result.error) };
  }
  return { ok: true, value: result.data };
}

/**
 * Parses and validates an event received from the worker. Never throws:
 * every malformed, oversized, unknown, or unsupported message comes back as a
 * typed failure so consumers can log and move on.
 */
export function parseEvent(input: RawMessage): ParseResult<AgentVoiceEvent> {
  return parseMessage<AgentVoiceEvent>(
    input,
    isEventType,
    (type) => eventSchemas[type as keyof typeof eventSchemas] as z.ZodType<AgentVoiceEvent>,
  );
}

/** Parses and validates a command received from the UI. Same guarantees as `parseEvent`. */
export function parseCommand(input: RawMessage): ParseResult<AgentVoiceCommand> {
  return parseMessage<AgentVoiceCommand>(
    input,
    isCommandType,
    (type) => commandSchemas[type as keyof typeof commandSchemas] as z.ZodType<AgentVoiceCommand>,
  );
}

export class ProtocolEncodeError extends Error {
  constructor(
    readonly failure: ParseFailure,
    message: string,
  ) {
    super(message);
    this.name = 'ProtocolEncodeError';
  }
}

function encodeValidated<T>(value: T, parse: (input: unknown) => ParseResult<T>): string {
  const checked = parse(value);
  if (!checked.ok) {
    throw new ProtocolEncodeError(checked, `refusing to encode message: ${checked.reason}`);
  }
  const text = JSON.stringify(checked.value);
  const bytes = utf8ByteLength(text);
  if (bytes > LIMITS.maxEventBytes) {
    throw new ProtocolEncodeError(
      { ok: false, reason: 'too_large', bytes },
      `refusing to encode message: ${bytes} bytes exceeds ${LIMITS.maxEventBytes}`,
    );
  }
  return text;
}

/** Validates and serialises an event. Throws `ProtocolEncodeError` rather than emit junk. */
export function encodeEvent(event: AgentVoiceEvent): string {
  return encodeValidated(event, parseEvent);
}

/** Validates and serialises a command. Throws `ProtocolEncodeError` rather than emit junk. */
export function encodeCommand(command: AgentVoiceCommand): string {
  return encodeValidated(command, parseCommand);
}
