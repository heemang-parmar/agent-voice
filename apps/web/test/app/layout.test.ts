import { describe, expect, it } from 'vitest';

import { metadata, viewport } from '@/app/layout';

describe('root layout metadata', () => {
  it('has an honest, non-empty title and description', () => {
    expect(typeof metadata.title).toBe('string');
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });

  it('does not borrow another product name for this interface', () => {
    const text = `${metadata.title as string} ${metadata.description as string}`;
    expect(text).not.toMatch(/chatgpt|openai|jarvis/i);
  });
});

describe('root layout viewport', () => {
  it('opts into the full display so the safe-area insets the dock uses are real', () => {
    expect(viewport.viewportFit).toBe('cover');
    expect(viewport.width).toBe('device-width');
    expect(viewport.initialScale).toBe(1);
  });

  it('declares the dark colour scheme it actually renders', () => {
    expect(viewport.colorScheme).toBe('dark');
    expect(viewport.themeColor).toBe('#08080a');
  });
});
