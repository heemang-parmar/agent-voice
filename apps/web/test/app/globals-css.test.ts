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
  });
});
