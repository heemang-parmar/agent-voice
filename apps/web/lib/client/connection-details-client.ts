import { z } from 'zod';

import { TransportError } from './transport';

export const CONNECTION_DETAILS_PATH = '/api/connection-details';

const detailsSchema = z.object({
  serverUrl: z.string().url(),
  roomName: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantToken: z.string().min(1),
  agentName: z.string().min(1),
  expiresAt: z.string().min(1),
});

export type ConnectionDetails = z.infer<typeof detailsSchema>;

const notConfiguredSchema = z.object({
  missing: z.array(z.string()).default([]),
  invalid: z.array(z.string()).default([]),
});

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Asks this deployment for a room and a short-lived participant token. The
 * body is always `{}`: nothing about the room, identity, agent or model is
 * chosen in the browser.
 */
export async function fetchConnectionDetails(signal: AbortSignal): Promise<ConnectionDetails> {
  let response: Response;
  try {
    response = await fetch(CONNECTION_DETAILS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new TransportError('aborted', 'The connection attempt was cancelled.');
    }
    throw new TransportError(
      'network',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 503) {
    const parsed = notConfiguredSchema.safeParse(await readJson(response));
    const details = parsed.success ? parsed.data : { missing: [], invalid: [] };
    throw new TransportError(
      'not_configured',
      'This deployment is not configured for voice yet.',
      details,
    );
  }
  if (response.status === 403) {
    throw new TransportError('forbidden', 'This page is not allowed to start a session.');
  }
  if (response.status === 429) {
    throw new TransportError(
      'rate_limited',
      'Too many session requests. Wait a moment and try again.',
    );
  }
  if (!response.ok) {
    throw new TransportError('server', 'The server could not start a session. Try again shortly.');
  }

  const parsed = detailsSchema.safeParse(await readJson(response));
  if (!parsed.success) {
    throw new TransportError('server', 'The server returned an unusable session response.');
  }
  return parsed.data;
}
