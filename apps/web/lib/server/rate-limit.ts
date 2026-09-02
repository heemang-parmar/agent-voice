import 'server-only';

export interface RateLimiterOptions {
  /** Requests allowed per key inside one window. */
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; the memory footprint is bounded by limit × maxKeys. */
  maxKeys?: number;
  now?: () => number;
}

export type RateLimitDecision =
  { allowed: true; remaining: number } | { allowed: false; retryAfterSeconds: number };

export interface RateLimiter {
  check(key: string): RateLimitDecision;
}

const DEFAULT_MAX_KEYS = 10_000;

/**
 * In-memory sliding-window limiter. It is deliberately simple: one process,
 * bounded memory, no persistence. It is the last line of defence for a route
 * that is already same-origin only; put a real limiter in front of it when
 * deploying behind a shared edge.
 */
export class SlidingWindowRateLimiter implements RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  private readonly hits = new Map<string, number[]>();

  constructor(options: RateLimiterOptions) {
    if (!Number.isInteger(options.limit) || options.limit < 1) {
      throw new Error('rate limiter limit must be a positive integer');
    }
    if (!Number.isFinite(options.windowMs) || options.windowMs < 1) {
      throw new Error('rate limiter window must be positive');
    }
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.hits.size;
  }

  check(key: string): RateLimitDecision {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      const retryAfterMs = Math.max(1, oldest + this.windowMs - now);
      this.hits.set(key, recent);
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }

    recent.push(now);
    this.hits.delete(key);
    this.makeRoom(cutoff);
    this.hits.set(key, recent);
    return { allowed: true, remaining: this.limit - recent.length };
  }

  /** Keeps the map under `maxKeys`: expired keys go first, then the oldest live ones. */
  private makeRoom(cutoff: number): void {
    if (this.hits.size < this.maxKeys) return;
    for (const [key, timestamps] of this.hits) {
      if (timestamps.every((ts) => ts <= cutoff)) this.hits.delete(key);
      if (this.hits.size < this.maxKeys) return;
    }
    while (this.hits.size >= this.maxKeys) {
      const oldest = this.hits.keys().next();
      if (oldest.done) return;
      this.hits.delete(oldest.value);
    }
  }
}
