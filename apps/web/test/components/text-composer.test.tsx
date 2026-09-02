import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextComposer } from '@/app/components/text-composer';

describe('TextComposer', () => {
  it('sends trimmed text on submit and clears the field', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<TextComposer disabled={false} onSend={onSend} />);
    const input = screen.getByRole('textbox', { name: /message/i });
    await user.type(input, '  hello there  ');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith('  hello there  ');
    expect(input).toHaveValue('');
  });

  it('submits on Enter without needing the mouse', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<TextComposer disabled={false} onSend={onSend} />);
    const input = screen.getByRole('textbox', { name: /message/i });
    await user.type(input, 'hi{Enter}');
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('does not send blank input', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<TextComposer disabled={false} onSend={onSend} />);
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('disables input and send while not connected', () => {
    render(<TextComposer disabled onSend={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /message/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });
});
