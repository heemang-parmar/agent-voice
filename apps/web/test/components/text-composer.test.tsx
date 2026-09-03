import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextComposer } from '@/app/components/text-composer';

describe('TextComposer', () => {
  it('invites the user with the Ask Kyra placeholder', () => {
    render(<TextComposer disabled={false} onSend={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: /message/i })).toHaveAttribute(
      'placeholder',
      'Ask Kyra',
    );
  });

  it('sends trimmed text on submit and clears the field', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<TextComposer disabled={false} onSend={onSend} />);
    const input = screen.getByRole('textbox', { name: /message/i });
    await user.type(input, '  hello there  ');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('  hello there  ');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
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
    const input = screen.getByRole('textbox', { name: /message/i });
    await user.type(input, '   {Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('keeps Send out of the way until the draft contains actual text', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<TextComposer disabled={false} onSend={onSend} />);
    const input = screen.getByRole('textbox', { name: /message/i });

    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
    await user.type(input, '   ');
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();

    await user.type(input, 'hello');
    const send = await screen.findByRole('button', { name: 'Send' });
    expect(send).toBeEnabled();

    await user.click(send);
    expect(onSend).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument();
  });

  it('disables input and send while not connected', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<TextComposer disabled={false} onSend={onSend} />);
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hello');

    rerender(<TextComposer disabled onSend={onSend} />);
    expect(screen.getByRole('textbox', { name: /message/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('keeps a real label on the icon-only send button', async () => {
    const user = userEvent.setup();
    const { container } = render(<TextComposer disabled={false} onSend={vi.fn()} />);
    await user.type(screen.getByRole('textbox', { name: /message/i }), 'hello');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('type', 'submit');
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
