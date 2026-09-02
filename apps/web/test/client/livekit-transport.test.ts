import { TOPICS, encodeEvent, parseCommand, type AgentVoiceCommand } from '@agent-voice/protocol';
import { eventFixtures } from '@agent-voice/protocol/fixtures';
import {
  DisconnectReason,
  ParticipantKind,
  RoomEvent,
  type RemoteParticipant,
  type RemoteTrack,
  type Room,
} from 'livekit-client';
import { describe, expect, it, vi } from 'vitest';

import type { ConnectionDetails } from '@/lib/client/connection-details-client';
import { AGENT_STATE_ATTRIBUTE, createLiveKitTransport } from '@/lib/client/livekit-transport';
import { TransportError, type TransportCallbacks } from '@/lib/client/transport';

const details: ConnectionDetails = {
  serverUrl: 'wss://livekit.example.test',
  roomName: 'room_x',
  participantIdentity: 'user_x',
  participantToken: 'jwt-placeholder',
  agentName: 'agent-voice',
  expiresAt: '2026-01-01T00:10:00.000Z',
};

type Listener = (...args: never[]) => void;

class FakeRoom {
  listeners = new Map<string, Set<Listener>>();
  connectCalls: [string, string, unknown][] = [];
  disconnectCalls = 0;
  startAudioCalls = 0;
  canPlaybackAudio = true;
  remoteParticipants = new Map<string, RemoteParticipant>();
  micCalls: boolean[] = [];
  published: { data: Uint8Array; options: unknown }[] = [];
  texts: { text: string; options: unknown }[] = [];
  connectImpl: () => Promise<void> = () => Promise.resolve();
  micImpl: (enabled: boolean) => Promise<void> = () => Promise.resolve();
  localParticipant = {
    setMicrophoneEnabled: (enabled: boolean) => {
      this.micCalls.push(enabled);
      return this.micImpl(enabled);
    },
    publishData: (data: Uint8Array, options: unknown) => {
      this.published.push({ data, options });
      return Promise.resolve();
    },
    sendText: (text: string, options: unknown) => {
      this.texts.push({ text, options });
      return Promise.resolve();
    },
  };

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }
  off(event: string, listener: Listener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? [])
      (listener as (...a: unknown[]) => void)(...args);
  }
  connect(url: string, token: string, options: unknown): Promise<void> {
    this.connectCalls.push([url, token, options]);
    return this.connectImpl();
  }
  disconnect(): Promise<void> {
    this.disconnectCalls += 1;
    return Promise.resolve();
  }
  startAudio(): Promise<void> {
    this.startAudioCalls += 1;
    this.canPlaybackAudio = true;
    return Promise.resolve();
  }
  listenerCount(): number {
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }
}

function participant(
  identity: string,
  agent: boolean,
  attributes: Record<string, string> = {},
): RemoteParticipant {
  return {
    identity,
    isAgent: agent,
    kind: agent ? ParticipantKind.AGENT : ParticipantKind.STANDARD,
    attributes,
  } as unknown as RemoteParticipant;
}

function audioTrack(): { track: RemoteTrack; element: HTMLAudioElement } {
  const element = document.createElement('audio');
  const track = {
    kind: 'audio',
    attach: () => element,
    detach: () => [element],
  } as unknown as RemoteTrack;
  return { track, element };
}

function recorder() {
  const calls: string[] = [];
  const callbacks: TransportCallbacks = {
    onConnected: () => calls.push('connected'),
    onAgentPresence: (present) => calls.push(`agent:${String(present)}`),
    onActivity: (activity) => calls.push(`activity:${activity}`),
    onEvent: (event) => calls.push(`event:${event.type}`),
    onDropped: (reason) => calls.push(`dropped:${reason}`),
    onReconnecting: () => calls.push('reconnecting'),
    onReconnected: () => calls.push('reconnected'),
    onDisconnected: (reason) => calls.push(`disconnected:${reason}`),
    onFailure: (error) => calls.push(`failure:${error.code}`),
    onMic: (enabled) => calls.push(`mic:${String(enabled)}`),
    onMicError: (message) => calls.push(`micError:${message ?? 'none'}`),
    onAudioBlocked: (blocked) => calls.push(`audioBlocked:${String(blocked)}`),
  };
  return { calls, callbacks };
}

function setup(
  overrides: { fetchDetails?: (signal: AbortSignal) => Promise<ConnectionDetails> } = {},
) {
  const room = new FakeRoom();
  const host = document.createElement('div');
  const fetchDetails = vi.fn(overrides.fetchDetails ?? (() => Promise.resolve(details)));
  const { calls, callbacks } = recorder();
  const transport = createLiveKitTransport(callbacks, {
    createRoom: () => room as unknown as Room,
    fetchDetails,
    audioHost: host,
  });
  return { room, host, fetchDetails, calls, transport };
}

const eventBytes = (event = eventFixtures['conversation.started']): Uint8Array =>
  new TextEncoder().encode(encodeEvent(event));

describe('createLiveKitTransport', () => {
  it('fetches details, joins the room, enables the microphone for voice sessions', async () => {
    const { room, fetchDetails, calls, transport } = setup();
    const signal = new AbortController().signal;
    await transport.connect('voice', signal);
    expect(fetchDetails).toHaveBeenCalledWith(signal);
    expect(room.connectCalls).toEqual([
      [
        'wss://livekit.example.test',
        'jwt-placeholder',
        expect.objectContaining({ autoSubscribe: true }),
      ],
    ]);
    expect(room.micCalls).toEqual([true]);
    expect(calls).toEqual(['connected', 'mic:true']);
  });

  it('leaves the microphone off for text sessions', async () => {
    const { room, calls, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    expect(room.micCalls).toEqual([]);
    expect(calls).toEqual(['connected']);
  });

  it('stays connected when the microphone is refused and reports why', async () => {
    const { room, calls, transport } = setup();
    room.micImpl = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    await transport.connect('voice', new AbortController().signal);
    expect(calls[0]).toBe('connected');
    expect(calls.some((call) => call.startsWith('micError:') && call.includes('permission'))).toBe(
      true,
    );
    expect(calls).not.toContain('mic:true');
  });

  it('picks up an agent that is already in the room, with its state', async () => {
    const { room, calls, transport } = setup();
    room.remoteParticipants.set(
      'agent',
      participant('agent-voice', true, { [AGENT_STATE_ATTRIBUTE]: 'listening' }),
    );
    room.remoteParticipants.set('other', participant('someone', false));
    await transport.connect('text', new AbortController().signal);
    expect(calls).toEqual(['connected', 'agent:true', 'activity:listening']);
  });

  it('reports playback blocking after connect and can resume it', async () => {
    const { room, calls, transport } = setup();
    room.canPlaybackAudio = false;
    await transport.connect('text', new AbortController().signal);
    expect(calls).toContain('audioBlocked:true');
    await transport.resumeAudio();
    expect(room.startAudioCalls).toBe(1);
    expect(calls.at(-1)).toBe('audioBlocked:false');
  });

  it('aborts cleanly if cancelled while the token is being fetched or the room is joining', async () => {
    let releaseFetch: (() => void) | null = null;
    const first = setup({
      fetchDetails: () =>
        new Promise<ConnectionDetails>((resolve) => {
          releaseFetch = () => {
            resolve(details);
          };
        }),
    });
    const controller = new AbortController();
    const pending = first.transport.connect('voice', controller.signal);
    controller.abort();
    (releaseFetch as (() => void) | null)?.();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(first.room.connectCalls).toHaveLength(0);
    expect(first.calls).toEqual([]);

    const second = setup();
    let releaseJoin: (() => void) | null = null;
    second.room.connectImpl = () =>
      new Promise<void>((resolve) => {
        releaseJoin = () => {
          resolve();
        };
      });
    const joinController = new AbortController();
    const joining = second.transport.connect('voice', joinController.signal);
    await Promise.resolve();
    joinController.abort();
    (releaseJoin as (() => void) | null)?.();
    await expect(joining).rejects.toMatchObject({ code: 'aborted' });
    expect(second.room.disconnectCalls).toBe(1);
    expect(second.calls).toEqual([]);
  });

  it('propagates token errors and turns join failures into connection errors', async () => {
    const failing = setup({
      fetchDetails: () => Promise.reject(new TransportError('forbidden', 'nope')),
    });
    await expect(
      failing.transport.connect('voice', new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'forbidden',
    });
    const { room, transport } = setup();
    room.connectImpl = () => Promise.reject(new Error('could not establish signal connection'));
    await expect(transport.connect('voice', new AbortController().signal)).rejects.toMatchObject({
      code: 'connection',
    });
    expect(room.disconnectCalls).toBe(1);
  });

  it('accepts protocol events only from the agent on the events topic', async () => {
    const { room, calls, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    const agent = participant('agent-voice', true);
    room.emit(RoomEvent.DataReceived, eventBytes(), agent, undefined, TOPICS.events);
    room.emit(RoomEvent.DataReceived, eventBytes(), agent, undefined, 'some.other.topic');
    room.emit(
      RoomEvent.DataReceived,
      eventBytes(),
      participant('stranger', false),
      undefined,
      TOPICS.events,
    );
    room.emit(RoomEvent.DataReceived, eventBytes(), undefined, undefined, TOPICS.events);
    room.emit(
      RoomEvent.DataReceived,
      new TextEncoder().encode('{not json'),
      agent,
      undefined,
      TOPICS.events,
    );
    room.emit(RoomEvent.DataReceived, new Uint8Array(13 * 1024), agent, undefined, TOPICS.events);
    expect(calls.slice(1)).toEqual([
      'event:conversation.started',
      'dropped:untrusted_sender',
      'dropped:untrusted_sender',
      'dropped:invalid_json',
      'dropped:too_large',
    ]);
  });

  it('tracks agent presence and activity from participant events and attributes', async () => {
    const { room, calls, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    const agent = participant('agent-voice', true, { [AGENT_STATE_ATTRIBUTE]: 'initializing' });
    room.emit(RoomEvent.ParticipantConnected, participant('viewer', false));
    room.emit(RoomEvent.ParticipantConnected, agent);
    room.emit(
      RoomEvent.ParticipantAttributesChanged,
      { [AGENT_STATE_ATTRIBUTE]: 'thinking' },
      agent,
    );
    room.emit(RoomEvent.ParticipantAttributesChanged, { unrelated: 'x' }, agent);
    room.emit(RoomEvent.ParticipantAttributesChanged, { [AGENT_STATE_ATTRIBUTE]: 'bogus' }, agent);
    room.emit(
      RoomEvent.ParticipantAttributesChanged,
      { [AGENT_STATE_ATTRIBUTE]: 'speaking' },
      participant('viewer', false),
    );
    room.emit(RoomEvent.ParticipantDisconnected, agent);
    expect(calls.slice(1)).toEqual([
      'agent:true',
      'activity:initializing',
      'activity:thinking',
      'agent:false',
    ]);
  });

  it('attaches and detaches remote audio and mirrors reconnect/disconnect events', async () => {
    const { room, host, calls, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    const { track, element } = audioTrack();
    room.emit(RoomEvent.TrackSubscribed, track, {}, participant('agent-voice', true));
    expect(host.contains(element)).toBe(true);
    expect(element.autoplay).toBe(true);
    room.emit(RoomEvent.TrackUnsubscribed, track, {}, participant('agent-voice', true));
    expect(host.contains(element)).toBe(false);

    room.emit(RoomEvent.AudioPlaybackStatusChanged, false);
    room.emit(RoomEvent.MediaDevicesError, new Error('device lost'));
    room.emit(RoomEvent.Reconnecting);
    room.emit(RoomEvent.Reconnected);
    room.emit(RoomEvent.Disconnected, DisconnectReason.SERVER_SHUTDOWN);
    expect(calls.slice(1)).toEqual([
      'audioBlocked:true',
      'micError:The microphone stopped working. You can keep typing.',
      'reconnecting',
      'reconnected',
      'disconnected:server_shutdown',
    ]);
  });

  it('publishes validated commands reliably on the commands topic and text on lk.chat', async () => {
    const { room, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    const command: AgentVoiceCommand = {
      v: 1,
      id: 'cmd_1',
      ts: '2026-01-01T00:00:00.000Z',
      conversationId: 'conv_1',
      type: 'action.cancel',
      actionId: 'act_1',
    };
    await transport.sendCommand(command);
    expect(room.published).toHaveLength(1);
    const sent = room.published[0];
    expect(sent?.options).toEqual({ reliable: true, topic: TOPICS.commands });
    expect(parseCommand(sent?.data)).toEqual({ ok: true, value: command });

    await expect(
      transport.sendCommand({ ...command, actionId: 'has spaces!' } as AgentVoiceCommand),
    ).rejects.toThrow();
    expect(room.published).toHaveLength(1);

    await transport.sendText('hello');
    expect(room.texts).toEqual([{ text: 'hello', options: { topic: 'lk.chat' } }]);
  });

  it('toggles the microphone and reports the result', async () => {
    const { room, calls, transport } = setup();
    await transport.connect('voice', new AbortController().signal);
    await transport.setMicrophoneEnabled(false);
    expect(room.micCalls).toEqual([true, false]);
    expect(calls.at(-1)).toBe('mic:false');
  });

  it('disconnect removes listeners, detaches audio and ignores late events', async () => {
    const { room, host, calls, transport } = setup();
    await transport.connect('text', new AbortController().signal);
    const { track, element } = audioTrack();
    room.emit(RoomEvent.TrackSubscribed, track, {}, participant('agent-voice', true));
    expect(room.listenerCount()).toBeGreaterThan(0);
    await transport.disconnect();
    expect(room.disconnectCalls).toBe(1);
    expect(room.listenerCount()).toBe(0);
    expect(host.contains(element)).toBe(false);
    const before = calls.length;
    room.emit(
      RoomEvent.DataReceived,
      eventBytes(),
      participant('agent-voice', true),
      undefined,
      TOPICS.events,
    );
    expect(calls.length).toBe(before);
    await transport.disconnect();
    expect(room.disconnectCalls).toBe(1);
  });
});
