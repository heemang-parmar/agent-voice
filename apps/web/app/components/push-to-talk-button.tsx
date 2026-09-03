'use client';

import { useRef, type KeyboardEvent, type PointerEvent } from 'react';

import type { PushToTalkPhase } from '@/lib/client/use-push-to-talk';

import { MicIcon } from './icons';

interface PushToTalkButtonProps {
  disabled: boolean;
  phase: PushToTalkPhase;
  onStart(): void;
  onRelease(): void;
}

const COPY: Record<PushToTalkPhase, { label: string; title: string }> = {
  idle: {
    label: 'Hold to talk',
    title: 'Hold to talk. On desktop, you can also hold Option + Space.',
  },
  starting: { label: 'Starting microphone', title: 'Starting microphone…' },
  listening: { label: 'Listening — release to send', title: 'Listening — release to send' },
  finishing: { label: 'Finishing voice input', title: 'Finishing voice input…' },
};

export function PushToTalkButton({ disabled, phase, onStart, onRelease }: PushToTalkButtonProps) {
  const pointerId = useRef<number | null>(null);
  const keyboardKey = useRef<string | null>(null);
  const copy = COPY[phase];

  const finishPointer = (event: PointerEvent<HTMLButtonElement>): void => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    onRelease();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (
      disabled ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      (event.key !== ' ' && event.key !== 'Enter') ||
      keyboardKey.current !== null
    ) {
      return;
    }
    event.preventDefault();
    keyboardKey.current = event.key;
    onStart();
  };

  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (keyboardKey.current !== event.key) return;
    event.preventDefault();
    keyboardKey.current = null;
    onRelease();
  };

  return (
    <button
      type="button"
      className="push-to-talk"
      data-phase={phase}
      aria-label={copy.label}
      aria-pressed={phase === 'starting' || phase === 'listening'}
      title={copy.title}
      disabled={disabled || phase === 'finishing'}
      onPointerDown={(event) => {
        if (disabled || phase === 'finishing' || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        pointerId.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        onStart();
      }}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onLostPointerCapture={(event) => {
        if (pointerId.current !== event.pointerId) return;
        pointerId.current = null;
        onRelease();
      }}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onBlur={() => {
        if (keyboardKey.current === null) return;
        keyboardKey.current = null;
        onRelease();
      }}
    >
      <MicIcon />
    </button>
  );
}
