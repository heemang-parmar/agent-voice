import { LIMITS, type AgentVoiceCommand, type AgentVoiceEvent } from '@agent-voice/protocol';
import { scenarios, type ScenarioName } from '@agent-voice/protocol/fixtures';

import type { SessionMode } from './session-state';
import { throwIfAborted, type Transport, type TransportCallbacks } from './transport';

export interface FixtureTransportOptions {
  scenario?: ScenarioName;
  /** Delay between played events. */
  stepMs?: number;
}

const DEFAULT_STEP_MS = 900;
const APPROVAL_WINDOW_MS = 120_000;
const DEMO_REPLY = 'This is a preview. A live worker would answer here and delegate real work.';

const ACTION_SCOPED = new Set<AgentVoiceEvent['type']>([
  'action.progress',
  'approval.requested',
  'approval.resolved',
  'artifact.created',
  'action.verified',
  'action.failed',
]);

/**
 * Plays one of the canonical protocol scenarios as if a worker were sending
 * it, honouring the UI's commands: approvals pause playback until answered,
 * a rejection or cancellation fails the action, and cancelling the
 * conversation ends it. No network, no credentials, no audio.
 */
export function createFixtureTransport(
  callbacks: TransportCallbacks,
  options: FixtureTransportOptions = {},
): Transport {
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS;
  const scenario = scenarios[options.scenario ?? 'delegation'];
  const conversationId = scenario.events[0]?.conversationId ?? 'conv_preview';

  let queue: AgentVoiceEvent[] = [...scenario.events];
  let closed = false;
  let connected = false;
  let endReason: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let counter = 0;
  let pausedFor: { actionId: string; approvalId: string } | null = null;
  const openActions = new Set<string>();

  const nextId = (prefix: string): string => {
    counter += 1;
    return `${prefix}_${String(counter)}`;
  };

  const emit = (event: AgentVoiceEvent): void => {
    if (closed) return;
    callbacks.onEvent({ ...event, ts: new Date().toISOString() });
  };

  const agentSays = (text: string): void => {
    callbacks.onActivity('speaking');
    emit({
      v: 1,
      id: nextId('fx_msg'),
      ts: '',
      conversationId,
      type: 'agent.message.final',
      messageId: nextId('msg'),
      text,
    });
    callbacks.onActivity('listening');
  };

  const clearTimer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const schedule = (): void => {
    if (closed || pausedFor || timer !== null || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = null;
      step();
    }, stepMs);
  };

  const step = (): void => {
    if (closed) return;
    const event = queue.shift();
    if (!event) {
      callbacks.onActivity('listening');
      return;
    }
    if (event.type === 'approval.resolved') {
      // The fixture's own decision is replaced by whatever the user chooses.
      step();
      return;
    }
    if (ACTION_SCOPED.has(event.type) && 'actionId' in event && !openActions.has(event.actionId)) {
      step();
      return;
    }
    switch (event.type) {
      case 'action.started':
        openActions.add(event.actionId);
        break;
      case 'action.verified':
      case 'action.failed':
        openActions.delete(event.actionId);
        break;
      case 'user.transcript.final':
        callbacks.onActivity('thinking');
        break;
      case 'agent.message.partial':
        callbacks.onActivity('speaking');
        break;
      default:
        break;
    }
    if (event.type === 'approval.requested') {
      pausedFor = { actionId: event.actionId, approvalId: event.approvalId };
      emit({ ...event, expiresAt: new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString() });
      return;
    }
    emit(event);
    if (event.type === 'agent.message.final') callbacks.onActivity('listening');
    if (event.type === 'conversation.cancelled') {
      endReason = event.reason;
      queue = [];
      return;
    }
    schedule();
  };

  const failAction = (actionId: string, code: 'rejected' | 'cancelled', summary: string): void => {
    openActions.delete(actionId);
    queue = queue.filter((event) => !('actionId' in event && event.actionId === actionId));
    emit({
      v: 1,
      id: nextId('fx_fail'),
      ts: '',
      conversationId,
      type: 'action.failed',
      actionId,
      code,
      summary,
      retryable: code === 'cancelled',
    });
  };

  return {
    async connect(_mode: SessionMode, signal: AbortSignal): Promise<void> {
      throwIfAborted(signal);
      await Promise.resolve();
      throwIfAborted(signal);
      connected = true;
      callbacks.onConnected();
      callbacks.onAgentPresence(true);
      callbacks.onActivity('listening');
      schedule();
    },

    sendCommand(command: AgentVoiceCommand): Promise<void> {
      if (closed || !connected) return Promise.resolve();
      switch (command.type) {
        case 'approval.respond': {
          const paused = pausedFor;
          if (
            !paused ||
            paused.actionId !== command.actionId ||
            paused.approvalId !== command.approvalId
          ) {
            break;
          }
          pausedFor = null;
          emit({
            v: 1,
            id: nextId('fx_res'),
            ts: '',
            conversationId,
            type: 'approval.resolved',
            actionId: command.actionId,
            approvalId: command.approvalId,
            decision: command.decision,
            resolvedBy: 'user',
          });
          if (command.decision === 'approved') {
            schedule();
          } else {
            failAction(
              command.actionId,
              'rejected',
              'You declined the approval, so nothing was changed.',
            );
            queue = queue.filter((event) => event.type === 'conversation.cancelled');
            agentSays('Understood. I have not made any changes.');
            schedule();
          }
          break;
        }
        case 'action.cancel': {
          if (!openActions.has(command.actionId)) break;
          if (pausedFor?.actionId === command.actionId) pausedFor = null;
          failAction(
            command.actionId,
            'cancelled',
            'Cancelled at your request before it completed.',
          );
          queue = queue.filter((event) => event.type === 'conversation.cancelled');
          agentSays('Cancelled. Nothing further was done.');
          schedule();
          break;
        }
        case 'conversation.cancel': {
          clearTimer();
          queue = [];
          pausedFor = null;
          for (const actionId of openActions) {
            failAction(
              actionId,
              'cancelled',
              'The conversation ended before this action completed.',
            );
          }
          endReason = 'user';
          emit({
            v: 1,
            id: nextId('fx_end'),
            ts: '',
            conversationId,
            type: 'conversation.cancelled',
            reason: 'user',
          });
          break;
        }
      }
      return Promise.resolve();
    },

    sendText(text: string): Promise<void> {
      if (closed || !connected) return Promise.resolve();
      const bounded = text.slice(0, LIMITS.maxTextChars);
      emit({
        v: 1,
        id: nextId('fx_u'),
        ts: '',
        conversationId,
        type: 'user.transcript.final',
        segmentId: nextId('seg'),
        text: bounded,
      });
      callbacks.onActivity('thinking');
      queue.push({
        v: 1,
        id: nextId('fx_a'),
        ts: '',
        conversationId,
        type: 'agent.message.final',
        messageId: nextId('msg'),
        text: DEMO_REPLY,
      });
      schedule();
      return Promise.resolve();
    },

    setMicrophoneEnabled(enabled: boolean): Promise<void> {
      callbacks.onMic(enabled);
      return Promise.resolve();
    },

    resumeAudio(): Promise<void> {
      callbacks.onAudioBlocked(false);
      return Promise.resolve();
    },

    disconnect(): Promise<void> {
      if (closed) return Promise.resolve();
      clearTimer();
      closed = true;
      if (connected) callbacks.onDisconnected(endReason ?? 'user');
      return Promise.resolve();
    },
  };
}
