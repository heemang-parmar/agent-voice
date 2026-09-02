import { z } from 'zod';

import { envelopeSchema, idSchema } from './envelope.js';

/**
 * Commands travel from the UI to the worker. They are deliberately few: the
 * UI can answer an approval, cancel one action, or cancel the conversation.
 * There is no command that grants blanket permissions or changes configuration.
 */
function defineCommand<S extends z.ZodRawShape & { type: z.ZodLiteral<string> }>(shape: S) {
  return envelopeSchema.extend(shape).strict();
}

const approvalRespond = defineCommand({
  type: z.literal('approval.respond'),
  actionId: idSchema,
  approvalId: idSchema,
  decision: z.enum(['approved', 'rejected']),
});

const actionCancel = defineCommand({
  type: z.literal('action.cancel'),
  actionId: idSchema,
});

const conversationCancel = defineCommand({ type: z.literal('conversation.cancel') });

export const commandSchemas = {
  'approval.respond': approvalRespond,
  'action.cancel': actionCancel,
  'conversation.cancel': conversationCancel,
} as const;

export type CommandType = keyof typeof commandSchemas;

export const COMMAND_TYPES = Object.keys(commandSchemas) as readonly CommandType[];

export const commandSchema = z.discriminatedUnion('type', [
  approvalRespond,
  actionCancel,
  conversationCancel,
]);

export type AgentVoiceCommand = z.infer<typeof commandSchema>;

export type CommandOfType<T extends CommandType> = Extract<AgentVoiceCommand, { type: T }>;

export function isCommandType(value: string): value is CommandType {
  return Object.prototype.hasOwnProperty.call(commandSchemas, value);
}
