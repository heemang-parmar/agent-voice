import 'server-only';

import { AccessToken, RoomAgentDispatch, RoomConfiguration, TrackSource } from 'livekit-server-sdk';

export interface MintTokenInput {
  apiKey: string;
  apiSecret: string;
  identity: string;
  roomName: string;
  ttlSeconds: number;
  /** Worker to dispatch into the room. Fixed by server configuration. */
  agentName: string;
}

/**
 * Signs a participant token with exactly the grants the browser needs: join
 * one freshly generated room, publish a microphone track and data messages,
 * subscribe to the agent's audio. No admin, recording, or metadata rights,
 * and the worker is dispatched by name so the client cannot pick another.
 */
export async function mintLiveKitToken(input: MintTokenInput): Promise<string> {
  const token = new AccessToken(input.apiKey, input.apiSecret, {
    identity: input.identity,
    ttl: input.ttlSeconds,
  });
  token.addGrant({
    room: input.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canUpdateOwnMetadata: false,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: input.agentName })],
  });
  return token.toJwt();
}
