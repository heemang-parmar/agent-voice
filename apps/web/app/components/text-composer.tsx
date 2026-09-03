'use client';

import { useEffect, useRef, useState } from 'react';

import { SendIcon } from './icons';

export interface TextComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
  autoFocus?: boolean;
}

export function TextComposer({ disabled, onSend, autoFocus = false }: TextComposerProps) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && !disabled) input.current?.focus();
  }, [autoFocus, disabled]);

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
        onChange={(event) => setValue(event.target.value)}
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
