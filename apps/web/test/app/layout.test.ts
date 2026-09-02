import { describe, expect, it } from 'vitest';

import { metadata } from '@/app/layout';

describe('root layout metadata', () => {
  it('has an honest, non-empty title and description', () => {
    expect(typeof metadata.title).toBe('string');
    expect((metadata.title as string).length).toBeGreaterThan(0);
    expect(typeof metadata.description).toBe('string');
    expect((metadata.description as string).length).toBeGreaterThan(0);
  });
});
