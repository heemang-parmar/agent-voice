'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

import { SendIcon } from './icons';

export interface TextComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onInteraction?: () => void;
}

export function TextComposer({
  disabled,
  onSend,
  autoFocus = false,
  inputRef,
  onInteraction,
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
        placeholder="Type a message"
        autoComplete="off"
        enterKeyHint="send"
        onPointerDown={onInteraction}
        onClick={onInteraction}
        onChange={(event) => {
          onInteraction?.();
          setValue(event.target.value);
        }}
      />
      <button
        type="submit"
        className="icon-button icon-button--accent"
        disabled={disabled || value.trim().length === 0}
        aria-label="Send"
        title="Send message"
      >
        <SendIcon />
      </button>
    </form>
  );
}
