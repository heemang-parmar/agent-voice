import {
  LIMITS,
  PROTOCOL_VERSION,
  TOPICS,
  encodeCommand,
  parseEvent,
  type AgentVoiceCommand,
  type AgentVoiceEvent,
} from '@agent-voice/protocol';
import {
  DisconnectReason,
  Room,
  RoomEvent,
  type DataPacket_Kind,
  type LocalParticipant,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type RoomEventCallbacks,
  type TranscriptionSegment,
} from 'livekit-client';

import { fetchConnectionDetails, type ConnectionDetails } from './connection-details-client';
import { AGENT_CAPTION_ID_PREFIX, type AgentActivity, type SessionMode } from './session-state';
import {
  TransportError,
  throwIfAborted,
  type Transport,
  type TransportCallbacks,
} from './transport';

/** Participant attribute the LiveKit Agents framework publishes for its state. */
export const AGENT_STATE_ATTRIBUTE = 'lk.agent.state';
/** Text-stream topic the worker's text input listens on. */
export const CHAT_TOPIC = 'lk.chat';

const ACTIVITIES = new Set<AgentActivity>(['initializing', 'listening', 'thinking', 'speaking']);
const MIC_DENIED = 'Microphone permission was not granted. You can keep typing.';
const MIC_LOST = 'The microphone stopped working. You can keep typing.';
const CAPTION_EVENT_ID_PREFIX = 'caption_event:';

export interface LiveKitTransportOptions {
  createRoom?: () => Room;
  fetchDetails?: (signal: AbortSignal) => Promise<ConnectionDetails>;
  /** Where remote audio elements are mounted; defaults to `document.body`. */
  audioHost?: HTMLElement;
}

function activityOf(participant: Participant): AgentActivity | null {
  const value = participant.attributes[AGENT_STATE_ATTRIBUTE];
  return value !== undefined && ACTIVITIES.has(value as AgentActivity)
    ? (value as AgentActivity)
    : null;
}

function disconnectReasonName(reason: DisconnectReason | undefined): string {
  if (reason === undefined) return 'unknown';
  const name = DisconnectReason[reason];
  return typeof name === 'string' ? name.toLowerCase() : 'unknown';
}

const PERMISSION_ERROR_NAMES = new Set([
  'NotAllowedError',
  'PermissionDeniedError',
  'SecurityError',
]);

function isPermissionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string' &&
    PERMISSION_ERROR_NAMES.has((error as { name: string }).name)
  );
}

function safeCaptionSegmentId(segmentId: string): string {
  const safe = segmentId.replace(/[^A-Za-z0-9_.:-]/gu, '_').slice(0, 28);
  return safe || 'segment';
}

/**
 * The real transport: one LiveKit room per session. Protocol events are only
 * accepted from agent participants on the events topic; commands go out as
 * reliable data packets; typed text uses the framework's chat text stream so
 * the worker treats it exactly like speech.
 */
export function createLiveKitTransport(
  callbacks: TransportCallbacks,
  options: LiveKitTransportOptions = {},
): Transport {
  const createRoom =
    options.createRoom ?? (() => new Room({ adaptiveStream: false, dynacast: false }));
  const fetchDetails = options.fetchDetails ?? fetchConnectionDetails;

  let room: Room | null = null;
  let conversationId: string | null = null;
  let captionEventSequence = 0;
  let live = false;
  let closed = false;
  const audioElements = new Map<RemoteTrack, HTMLMediaElement[]>();
  const teardownListeners: (() => void)[] = [];

  const audioHost = (): HTMLElement => options.audioHost ?? document.body;

  const attachAudio = (track: RemoteTrack): void => {
    if (track.kind !== 'audio') return;
    const element = track.attach();
    element.autoplay = true;
    element.setAttribute('data-agent-voice-audio', '');
    audioHost().appendChild(element);
    audioElements.set(track, [...(audioElements.get(track) ?? []), element]);
  };

  const detachAudio = (track: RemoteTrack): void => {
    for (const element of audioElements.get(track) ?? []) element.remove();
    audioElements.delete(track);
    for (const element of track.detach()) element.remove();
  };

  const detachAllAudio = (): void => {
    for (const [track] of audioElements) detachAudio(track);
  };

  const listen = <E extends keyof RoomEventCallbacks>(
    target: Room,
    event: E,
    listener: RoomEventCallbacks[E],
  ): void => {
    target.on(event, listener);
    teardownListeners.push(() => {
      target.off(event, listener);
    });
  };

  const guard = <A extends unknown[]>(fn: (...args: A) => void): ((...args: A) => void) => {
    return (...args) => {
      if (live && !closed) fn(...args);
    };
  };

  const handleData = (
    payload: Uint8Array,
    participant?: RemoteParticipant,
    _kind?: DataPacket_Kind,
    topic?: string,
  ): void => {
    if (topic !== TOPICS.events) return;
    if (!participant?.isAgent) {
      callbacks.onDropped('untrusted_sender');
      return;
    }
    const parsed = parseEvent(payload);
    if (!parsed.ok) {
      callbacks.onDropped(parsed.reason);
      return;
    }
    callbacks.onEvent(parsed.value);
  };

  const handleTranscription = (
    segments: TranscriptionSegment[],
    participant?: Participant,
  ): void => {
    if (!participant?.isAgent || conversationId === null) return;

    for (const segment of segments) {
      const text = segment.text.trim().slice(0, LIMITS.maxTextChars);
      if (!text) continue;
      const segmentId = safeCaptionSegmentId(segment.id);
      captionEventSequence += 1;
      const event: AgentVoiceEvent = {
        v: PROTOCOL_VERSION,
        type: segment.final ? 'agent.message.final' : 'agent.message.partial',
        id: `${CAPTION_EVENT_ID_PREFIX}${segmentId}:${String(captionEventSequence)}`,
        ts: new Date().toISOString(),
        conversationId,
        messageId: `${AGENT_CAPTION_ID_PREFIX}${segmentId}`,
        text,
      };
      callbacks.onEvent(event);
    }
  };

  const announceAgent = (participant: Participant): void => {
    callbacks.onAgentPresence(true);
    const activity = activityOf(participant);
    if (activity) callbacks.onActivity(activity);
  };

  const wire = (target: Room): void => {
    listen(target, RoomEvent.DataReceived, guard(handleData));
    listen(target, RoomEvent.TranscriptionReceived, guard(handleTranscription));
    listen(
      target,
      RoomEvent.ParticipantConnected,
      guard((participant: RemoteParticipant) => {
        if (participant.isAgent) announceAgent(participant);
      }),
    );
    listen(
      target,
      RoomEvent.ParticipantDisconnected,
      guard((participant: RemoteParticipant) => {
        if (participant.isAgent) callbacks.onAgentPresence(false);
      }),
    );
    listen(
      target,
      RoomEvent.ParticipantAttributesChanged,
      guard(
        (changed: Record<string, string>, participant: RemoteParticipant | LocalParticipant) => {
          if (!participant.isAgent || !(AGENT_STATE_ATTRIBUTE in changed)) return;
          const value = changed[AGENT_STATE_ATTRIBUTE];
          if (value !== undefined && ACTIVITIES.has(value as AgentActivity)) {
            callbacks.onActivity(value as AgentActivity);
          }
        },
      ),
    );
    listen(
      target,
      RoomEvent.TrackSubscribed,
      guard(
        (
          track: RemoteTrack,
          _publication: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (participant.isAgent) attachAudio(track);
        },
      ),
    );
    listen(
      target,
      RoomEvent.TrackUnsubscribed,
      guard((track: RemoteTrack) => {
        detachAudio(track);
      }),
    );
    listen(
      target,
      RoomEvent.AudioPlaybackStatusChanged,
      guard((playing: boolean) => {
        callbacks.onAudioBlocked(!playing);
      }),
    );
    listen(
      target,
      RoomEvent.MediaDevicesError,
      guard(() => {
        callbacks.onMicError(MIC_LOST);
      }),
    );
    listen(
      target,
      RoomEvent.Reconnecting,
      guard(() => callbacks.onReconnecting()),
    );
    listen(
      target,
      RoomEvent.Reconnected,
      guard(() => callbacks.onReconnected()),
    );
    listen(
      target,
      RoomEvent.Disconnected,
      guard((reason?: DisconnectReason) => {
        live = false;
        detachAllAudio();
        callbacks.onDisconnected(disconnectReasonName(reason));
      }),
    );
  };

  const release = async (): Promise<void> => {
    for (const off of teardownListeners.splice(0)) off();
    detachAllAudio();
    const target = room;
    room = null;
    if (target) await target.disconnect();
  };

  return {
    async connect(mode: SessionMode, signal: AbortSignal): Promise<void> {
      if (closed) throw new TransportError('aborted', 'This session was already closed.');
      throwIfAborted(signal);
      const details = await fetchDetails(signal);
      conversationId = details.roomName;
      throwIfAborted(signal);

      const target = createRoom();
      room = target;
      wire(target);
      try {
        await target.connect(details.serverUrl, details.participantToken, { autoSubscribe: true });
      } catch (error) {
        await release();
        if (signal.aborted)
          throw new TransportError('aborted', 'The connection attempt was cancelled.');
        console.warn(
          `[agent-voice] room_connect_failed: ${error instanceof Error ? error.name : typeof error}`,
        );
        throw new TransportError('connection', 'Could not join the voice room. Please try again.');
      }
      if (signal.aborted) {
        await release();
        throw new TransportError('aborted', 'The connection attempt was cancelled.');
      }

      live = true;
      callbacks.onConnected();

      for (const participant of target.remoteParticipants.values()) {
        if (participant.isAgent) {
          announceAgent(participant);
          break;
        }
      }
      if (!target.canPlaybackAudio) callbacks.onAudioBlocked(true);

      if (mode === 'voice') {
        try {
          await target.localParticipant.setMicrophoneEnabled(true);
          callbacks.onMic(true);
        } catch (error) {
          callbacks.onMicError(isPermissionError(error) ? MIC_DENIED : MIC_LOST);
        }
      }
    },

    async sendCommand(command: AgentVoiceCommand): Promise<void> {
      const target = room;
      if (!target || !live) return;
      const payload = new TextEncoder().encode(encodeCommand(command));
      await target.localParticipant.publishData(payload, {
        reliable: true,
        topic: TOPICS.commands,
      });
    },

    async sendText(text: string): Promise<void> {
      const target = room;
      if (!target || !live) return;
      await target.localParticipant.sendText(text, { topic: CHAT_TOPIC });
    },

    async setMicrophoneEnabled(enabled: boolean): Promise<void> {
      const target = room;
      if (!target || !live) return;
      try {
        await target.localParticipant.setMicrophoneEnabled(enabled);
        callbacks.onMic(enabled);
      } catch (error) {
        callbacks.onMicError(isPermissionError(error) ? MIC_DENIED : MIC_LOST);
      }
    },

    async resumeAudio(): Promise<void> {
      const target = room;
      if (!target || !live) return;
      await target.startAudio();
      callbacks.onAudioBlocked(!target.canPlaybackAudio);
    },

    async disconnect(): Promise<void> {
      if (closed) return;
      closed = true;
      live = false;
      await release();
    },
  };
}
