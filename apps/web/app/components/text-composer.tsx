'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import type { PushToTalkPhase } from '@/lib/client/use-push-to-talk';

import { SendIcon } from './icons';
import { PushToTalkButton } from './push-to-talk-button';

export interface TextComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onInteraction?: () => void;
  pushToTalk?: {
    disabled: boolean;
    phase: PushToTalkPhase;
    onStart(): void;
    onRelease(): void;
  };
}

export function TextComposer({
  disabled,
  onSend,
  autoFocus = false,
  inputRef,
  onInteraction,
  pushToTalk,
}: TextComposerProps) {
  const [value, setValue] = useState('');
  const localInput = useRef<HTMLInputElement>(null);
  const input = inputRef ?? localInput;

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled, input]);

  const submit = (): void => {
    if (value.trim().length === 0) return;
    onSend(value);
    setValue('');
  };

  return (
    <form
      className="text-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="text-composer-input" className="sr-only">
        Message
      </label>
      <input
        ref={input}
        id="text-composer-input"
        className="text-composer__input"
        type="text"
        value={value}
        disabled={disabled}
        placeholder="Ask Kyra"
        autoComplete="off"
        enterKeyHint="send"
        onPointerDown={onInteraction}
        onClick={onInteraction}
        onChange={(event) => {
          onInteraction?.();
          setValue(event.target.value);
        }}
      />
      {pushToTalk ? <PushToTalkButton {...pushToTalk} /> : null}
      {value.trim().length > 0 ? (
        <button
          type="submit"
          className="icon-button icon-button--accent"
          disabled={disabled}
          aria-label="Send"
          title="Send message"
        >
          <SendIcon />
        </button>
      ) : null}
    </form>
  );
}
