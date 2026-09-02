import { z } from 'zod';

import { LIMITS, PROTOCOL_VERSION } from './limits.js';

/** Identifiers are opaque, printable, and bounded. */
export const idSchema = z
  .string()
  .min(1)
  .max(LIMITS.maxIdChars)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'identifier contains unsupported characters');

/** Timestamps are ISO-8601 with an explicit zone. */
export const timestampSchema = z.iso.datetime({ offset: true });

export const labelSchema = z.string().min(1).max(LIMITS.maxLabelChars);
export const textSchema = z.string().max(LIMITS.maxTextChars);
export const messageSchema = z.string().min(1).max(LIMITS.maxMessageChars);

/**
 * Fields shared by every event and command. `type` is refined by each
 * concrete schema; keeping it a plain string here lets the parser detect
 * "well-formed envelope, unknown type" separately from "garbage".
 */
export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: idSchema,
  ts: timestampSchema,
  conversationId: idSchema,
  type: z.string().min(1).max(LIMITS.maxLabelChars),
});

export type Envelope = z.infer<typeof envelopeSchema>;
