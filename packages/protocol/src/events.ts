import { z } from 'zod';

import { artifactListSchema, artifactSchema } from './artifacts.js';
import {
  envelopeSchema,
  idSchema,
  labelSchema,
  messageSchema,
  textSchema,
  timestampSchema,
} from './envelope.js';

/**
 * Every event is the shared envelope plus a `type` literal plus its own
 * fields, and it is strict: unknown keys are rejected rather than ignored so
 * nothing can be smuggled past validation.
 */
function defineEvent<S extends z.ZodRawShape & { type: z.ZodLiteral<string> }>(shape: S) {
  return envelopeSchema.extend(shape).strict();
}

/** Why an action did not reach a verified result. */
export const FAILURE_CODES = [
  'failed',
  'unavailable',
  'timeout',
  'cancelled',
  'rejected',
  'expired',
  'invalid',
] as const;
export const failureCodeSchema = z.enum(FAILURE_CODES);
export type FailureCode = z.infer<typeof failureCodeSchema>;

export const approvalDecisionSchema = z.enum(['approved', 'rejected', 'expired']);
export type ApprovalDecision = z.infer<typeof approvalDecisionSchema>;

/**
 * A verified result is one the adapter actually obtained from the delegated
 * agent (as opposed to something the voice model could have made up).
 */
export const verificationSchema = z.strictObject({
  state: z.enum(['verified', 'unverified']),
  method: labelSchema,
  detail: z.string().max(1000).optional(),
});
export type Verification = z.infer<typeof verificationSchema>;

const conversationStarted = defineEvent({
  type: z.literal('conversation.started'),
  agentName: labelSchema,
  adapter: labelSchema,
});

const userTranscriptPartial = defineEvent({
  type: z.literal('user.transcript.partial'),
  segmentId: idSchema,
  text: textSchema,
});

const userTranscriptFinal = defineEvent({
  type: z.literal('user.transcript.final'),
  segmentId: idSchema,
  text: textSchema,
});

const agentMessagePartial = defineEvent({
  type: z.literal('agent.message.partial'),
  messageId: idSchema,
  text: textSchema,
});

const agentMessageFinal = defineEvent({
  type: z.literal('agent.message.final'),
  messageId: idSchema,
  text: textSchema,
});

const actionStarted = defineEvent({
  type: z.literal('action.started'),
  actionId: idSchema,
  title: labelSchema,
  adapter: labelSchema,
});

const actionProgress = defineEvent({
  type: z.literal('action.progress'),
  actionId: idSchema,
  message: messageSchema,
  percent: z.number().min(0).max(100).optional(),
});

/** Approvals are always bound to one action and always expire. */
const approvalRequested = defineEvent({
  type: z.literal('approval.requested'),
  actionId: idSchema,
  approvalId: idSchema,
  prompt: messageSchema,
  expiresAt: timestampSchema,
});

const approvalResolved = defineEvent({
  type: z.literal('approval.resolved'),
  actionId: idSchema,
  approvalId: idSchema,
  decision: approvalDecisionSchema,
  resolvedBy: z.enum(['user', 'system']).optional(),
});

const artifactCreated = defineEvent({
  type: z.literal('artifact.created'),
  actionId: idSchema,
  artifact: artifactSchema,
});

const actionVerified = defineEvent({
  type: z.literal('action.verified'),
  actionId: idSchema,
  summary: textSchema,
  verification: verificationSchema.extend({ state: z.literal('verified') }).strict(),
  artifacts: artifactListSchema.optional(),
});

const actionFailed = defineEvent({
  type: z.literal('action.failed'),
  actionId: idSchema,
  code: failureCodeSchema,
  summary: textSchema,
  retryable: z.boolean(),
});

const conversationCancelled = defineEvent({
  type: z.literal('conversation.cancelled'),
  reason: z.enum(['user', 'agent', 'error', 'timeout']),
  detail: z.string().max(1000).optional(),
});

/** Every concrete event schema, keyed by its `type` literal. */
export const eventSchemas = {
  'conversation.started': conversationStarted,
  'user.transcript.partial': userTranscriptPartial,
  'user.transcript.final': userTranscriptFinal,
  'agent.message.partial': agentMessagePartial,
  'agent.message.final': agentMessageFinal,
  'action.started': actionStarted,
  'action.progress': actionProgress,
  'approval.requested': approvalRequested,
  'approval.resolved': approvalResolved,
  'artifact.created': artifactCreated,
  'action.verified': actionVerified,
  'action.failed': actionFailed,
  'conversation.cancelled': conversationCancelled,
} as const;

export type EventType = keyof typeof eventSchemas;

export const EVENT_TYPES = Object.keys(eventSchemas) as readonly EventType[];

export const eventSchema = z.discriminatedUnion('type', [
  conversationStarted,
  userTranscriptPartial,
  userTranscriptFinal,
  agentMessagePartial,
  agentMessageFinal,
  actionStarted,
  actionProgress,
  approvalRequested,
  approvalResolved,
  artifactCreated,
  actionVerified,
  actionFailed,
  conversationCancelled,
]);

export type AgentVoiceEvent = z.infer<typeof eventSchema>;

export type EventOfType<T extends EventType> = Extract<AgentVoiceEvent, { type: T }>;

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(eventSchemas, value);
}
