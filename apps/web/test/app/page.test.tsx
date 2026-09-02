import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Page from '@/app/page';

describe('Home page', () => {
  it('renders the start screen without starting a session', () => {
    render(<Page />);
    expect(screen.getByRole('button', { name: /start voice/i })).toBeInTheDocument();
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
  });
});
