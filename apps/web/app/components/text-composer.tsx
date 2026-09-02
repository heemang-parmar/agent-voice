'use client';

import { useState } from 'react';

export interface TextComposerProps {
  disabled: boolean;
  onSend: (text: string) => void;
}

export function TextComposer({ disabled, onSend }: TextComposerProps) {
  const [value, setValue] = useState('');

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
        id="text-composer-input"
        className="text-composer__input"
        type="text"
        value={value}
        disabled={disabled}
        placeholder="Type a message"
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="button button--primary" disabled={disabled}>
        Send
      </button>
    </form>
  );
}
