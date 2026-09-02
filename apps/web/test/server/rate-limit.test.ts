// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { SlidingWindowRateLimiter } from '@/lib/server/rate-limit';

function clock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the limit per key inside the window and then refuses', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000, now: time.now });
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
    // Other keys are independent.
    expect(limiter.check('b')).toEqual({ allowed: true, remaining: 2 });
  });

  it('frees a slot when the oldest request leaves the window', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 10_000, now: time.now });
    limiter.check('a');
    time.advance(4_000);
    limiter.check('a');
    expect(limiter.check('a')).toEqual({ allowed: false, retryAfterSeconds: 6 });
    time.advance(6_000);
    expect(limiter.check('a')).toEqual({ allowed: true, remaining: 0 });
  });

  it('never tracks more than maxKeys entries', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter({
      limit: 5,
      windowMs: 60_000,
      maxKeys: 3,
      now: time.now,
    });
    for (let i = 0; i < 50; i += 1) limiter.check(`key-${i}`);
    expect(limiter.size).toBeLessThanOrEqual(3);
  });

  it('drops expired keys before evicting live ones', () => {
    const time = clock();
    const limiter = new SlidingWindowRateLimiter({
      limit: 1,
      windowMs: 1_000,
      maxKeys: 2,
      now: time.now,
    });
    limiter.check('old');
    time.advance(2_000);
    limiter.check('live');
    limiter.check('newer');
    expect(limiter.size).toBe(2);
    // 'live' was not evicted: it is still limited.
    expect(limiter.check('live')).toMatchObject({ allowed: false });
  });

  it('rejects unusable options', () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
