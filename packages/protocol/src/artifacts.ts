import { z } from 'zod';

import { idSchema, labelSchema } from './envelope.js';
import { LIMITS } from './limits.js';

/**
 * Artifact URLs come from the delegated agent and are untrusted. Only absolute
 * http(s) URLs without embedded credentials are accepted; everything else
 * (javascript:, data:, blob:, file:, relative paths) is rejected at the
 * protocol boundary so the UI never has to decide whether a link is safe.
 */
export function isSafeArtifactUrl(value: string): boolean {
  if (value.length === 0 || value.length > LIMITS.maxUrlChars) return false;
  if (/\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username !== '' || url.password !== '') return false;
  return url.hostname.length > 0;
}

export const artifactUrlSchema = z
  .string()
  .max(LIMITS.maxUrlChars)
  .refine(isSafeArtifactUrl, 'artifact url must be an absolute http(s) url without credentials');

const artifactBase = {
  id: idSchema,
  title: labelSchema,
};

export const artifactSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...artifactBase,
    kind: z.literal('link'),
    url: artifactUrlSchema,
  }),
  z.strictObject({
    ...artifactBase,
    kind: z.literal('file'),
    url: artifactUrlSchema,
    mimeType: z.string().min(1).max(LIMITS.maxLabelChars).optional(),
    bytes: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...artifactBase,
    kind: z.literal('text'),
    text: z.string().max(LIMITS.maxArtifactTextChars),
  }),
]);

export type Artifact = z.infer<typeof artifactSchema>;

export const artifactListSchema = z.array(artifactSchema).max(LIMITS.maxArtifacts);
