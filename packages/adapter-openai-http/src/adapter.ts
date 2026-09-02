import type {
  ActionContext,
  AdapterRequest,
  AdapterResult,
  AgentAdapter,
} from '@agent-voice/adapter-sdk';
import { LIMITS, type FailureCode } from '@agent-voice/protocol';

/** Structured, redaction-safe logging: event names and scalar fields only. */
export interface AdapterLogger {
  warn(event: string, fields?: Record<string, string | number | boolean>): void;
}

export interface OpenAiHttpAdapterOptions {
  /** Base URL of an OpenAI-compatible API, e.g. `http://127.0.0.1:8642/v1`. Server-side only. */
  endpoint: string;
  /** Optional bearer key. Never logged, never echoed. */
  apiKey?: string | undefined;
  model: string;
  /** Header that carries the stable session key. Defaults to `X-Session-Key`. */
  sessionHeader?: string;
  /** Upper bound for the HTTP round-trip, further capped by the action deadline. */
  timeoutMs?: number;
  /** Upper bound for the response body in bytes. */
  maxResponseBytes?: number;
  systemPrompt?: string;
  fetch?: typeof fetch;
  logger?: AdapterLogger;
}

export const DEFAULT_SYSTEM_PROMPT =
  'You are the execution agent behind a voice assistant. Perform the task using your normal ' +
  'tools and approval policy. Return one JSON object only: no Markdown fence or commentary. ' +
  'Its exact top-level keys are status, summary, and verification. Status must be verified, ' +
  'failed, unavailable, or cancelled. Verification has state and method, plus optional detail. ' +
  'Use status "verified" only after verifying the underlying action, with state "verified" ' +
  'and a concrete method. Every other status requires state "unverified". Never treat a ' +
  'completion sentence as proof.';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;

type Outcome =
  | { kind: 'ok'; result: AdapterResult }
  | { kind: 'fail'; status: 'failed' | 'unavailable' | 'cancelled'; code: FailureCode };

interface ChatCompletionShape {
  choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function parseAgentResult(text: string, truncated: boolean): AdapterResult | null {
  if (truncated) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['status', 'summary', 'verification'])) return null;
  const status = value.status;
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const verification = value.verification;
  if (
    typeof status !== 'string' ||
    !['verified', 'failed', 'unavailable', 'cancelled'].includes(status) ||
    summary.length === 0 ||
    summary.length > LIMITS.maxTextChars ||
    !isRecord(verification) ||
    !hasOnlyKeys(verification, ['state', 'method', 'detail'])
  ) {
    return null;
  }
  const state = verification.state;
  const method = typeof verification.method === 'string' ? verification.method.trim() : '';
  const detail = verification.detail;
  if (
    typeof state !== 'string' ||
    (state !== 'verified' && state !== 'unverified') ||
    method.length === 0 ||
    method.length > LIMITS.maxLabelChars ||
    (detail !== undefined && (typeof detail !== 'string' || detail.length > 1000)) ||
    (status === 'verified') !== (state === 'verified')
  ) {
    return null;
  }
  return {
    status: status as AdapterResult['status'],
    summary,
    verification: { state, method, ...(detail === undefined ? {} : { detail }) },
    artifacts: [],
    retryable: status === 'unavailable',
  };
}

function normaliseEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('agent endpoint must be an absolute http(s) URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('agent endpoint must use http or https');
  }
  return url.toString().replace(/\/+$/, '');
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const part of content as unknown[]) {
    if (typeof part !== 'object' || part === null) continue;
    const record = part as Record<string, unknown>;
    if (record.type === 'text' && typeof record.text === 'string') parts.push(record.text);
  }
  return parts.join('');
}

/** Reads at most `maxBytes`; returns null (and stops reading) when the body is larger. */
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.byteLength > maxBytes ? null : buffer;
  }
  const body = response.body as ReadableStream<Uint8Array>;
  const reader = body.getReader();
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

function errorClass(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Delegates a request to an OpenAI-compatible `chat/completions` endpoint.
 * Only an explicit, structurally valid verification result can become verified;
 * plain assistant prose and truncated responses fail closed.
 */
export class OpenAiHttpAdapter implements AgentAdapter {
  readonly name = 'openai-http';

  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly sessionHeader: string;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly systemPrompt: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: AdapterLogger | undefined;

  constructor(options: OpenAiHttpAdapterOptions) {
    this.endpoint = normaliseEndpoint(options.endpoint);
    const key = options.apiKey?.trim() ?? '';
    this.apiKey = key.length > 0 ? key : undefined;
    this.model = options.model;
    this.sessionHeader = options.sessionHeader ?? 'X-Session-Key';
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.logger = options.logger;
  }

  async run(request: AdapterRequest, context: ActionContext): Promise<AdapterResult> {
    const outcome = await this.call(request, context);
    if (outcome.kind === 'ok') {
      return outcome.result;
    }
    return {
      status: outcome.status,
      code: outcome.code,
      summary: '',
      verification: { state: 'unverified', method: 'openai-http:response' },
      artifacts: [],
      retryable: outcome.status === 'unavailable',
    };
  }

  private async call(request: AdapterRequest, context: ActionContext): Promise<Outcome> {
    const text = request.text.slice(0, LIMITS.maxTextChars);
    const body = JSON.stringify({
      model: this.model,
      stream: false,
      user: request.sessionKey,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: text },
      ],
    });
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return { kind: 'fail', status: 'failed', code: 'invalid' };
    }

    const headers = new Headers({
      'content-type': 'application/json',
      accept: 'application/json',
      [this.sessionHeader]: request.sessionKey,
    });
    if (this.apiKey !== undefined) headers.set('authorization', `Bearer ${this.apiKey}`);

    const budget = Math.max(0, Math.min(this.timeoutMs, context.deadline - Date.now()));
    const timeoutSignal = AbortSignal.timeout(budget);
    const signal = AbortSignal.any([context.signal, timeoutSignal]);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal,
        redirect: 'error',
      });
    } catch (error) {
      if (context.signal.aborted) return { kind: 'fail', status: 'cancelled', code: 'cancelled' };
      if (timeoutSignal.aborted) return { kind: 'fail', status: 'unavailable', code: 'timeout' };
      this.logger?.warn('openai_http.transport_error', { error: errorClass(error) });
      return { kind: 'fail', status: 'unavailable', code: 'unavailable' };
    }

    if (!response.ok) {
      this.logger?.warn('openai_http.http_error', { status: response.status });
      await response.body?.cancel().catch(() => undefined);
      const unavailable = response.status >= 500 || response.status === 429;
      return unavailable
        ? { kind: 'fail', status: 'unavailable', code: 'unavailable' }
        : { kind: 'fail', status: 'failed', code: 'failed' };
    }

    let bytes: Uint8Array | null;
    try {
      bytes = await readBounded(response, this.maxResponseBytes);
    } catch (error) {
      if (context.signal.aborted) return { kind: 'fail', status: 'cancelled', code: 'cancelled' };
      this.logger?.warn('openai_http.read_error', { error: errorClass(error) });
      return { kind: 'fail', status: 'unavailable', code: 'unavailable' };
    }
    if (bytes === null) {
      this.logger?.warn('openai_http.response_too_large', { limit: this.maxResponseBytes });
      return { kind: 'fail', status: 'failed', code: 'invalid' };
    }

    let parsed: ChatCompletionShape;
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      parsed = JSON.parse(decoded) as ChatCompletionShape;
    } catch {
      this.logger?.warn('openai_http.malformed_response');
      return { kind: 'fail', status: 'failed', code: 'failed' };
    }
    const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
    const trimmed = extractText(choice?.message?.content)?.trim() ?? '';
    if (trimmed.length === 0) {
      this.logger?.warn('openai_http.empty_response');
      return { kind: 'fail', status: 'failed', code: 'failed' };
    }
    const result = parseAgentResult(trimmed, choice?.finish_reason === 'length');
    if (result === null) {
      this.logger?.warn('openai_http.invalid_agent_result');
      return { kind: 'fail', status: 'failed', code: 'invalid' };
    }
    return { kind: 'ok', result };
  }
}
