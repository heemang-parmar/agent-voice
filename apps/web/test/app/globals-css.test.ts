import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8');

describe('globals.css', () => {
  it('stays within the neutral graphite/silver system: no gradients or neon glow', () => {
    expect(css).not.toMatch(/gradient/i);
    expect(css).not.toMatch(/neon/i);
    expect(css).not.toMatch(/box-shadow:\s*0\s*0\s*\d+px\s*\d+px/i);
  });

  it('respects prefers-reduced-motion', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/i);
  });

  it('defines a visible focus style', () => {
    expect(css).toMatch(/:focus-visible/);
  });

  it('is responsive down to 320px without relying on fixed oversized widths', () => {
    expect(css).toMatch(/@media/);
    expect(css).toMatch(/min-width:\s*320px/);
    // No fixed pixel width may exceed the narrowest supported viewport.
    expect(css).not.toMatch(/[^-]width:\s*\d{3,}px/);
  });

  it('declares itself dark so form controls and scrollbars match the canvas', () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it('honours the device safe areas on all four edges of the full-screen stage', () => {
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      expect(css).toMatch(new RegExp(`env\\(safe-area-inset-${edge}`));
    }
  });

  it('keeps interactive targets at or above the 44px minimum', () => {
    expect(css).toMatch(/--control:\s*44px/);
    expect(css).toMatch(/min-height:\s*var\(--control\)/);
  });

  it('uses restrained ProductOS-style mono telemetry so status never competes with the orb', () => {
    expect(css).toMatch(
      /\.status-badge\[data-variant='orb'\][\s\S]*font-family:\s*var\(--font-mono\)/,
    );
    expect(css).toMatch(/\.status-badge\[data-variant='orb'\][\s\S]*text-transform:\s*uppercase/);
    expect(css).toMatch(/\.status-badge\[data-variant='orb'\][\s\S]*font-size:\s*0\.6875rem/);
  });

  it('scales the orb from the single tuned canvas size the package ships', () => {
    expect(css).toMatch(/--orb-scale:\s*3\.0625/);
    expect(css).toMatch(/transform:\s*scale\(var\(--orb-scale\)\)/);
  });
});
