type Bucket = {
  count: number;
  windowStart: number;
};

export type RateLimiter = {
  buckets: Map<string, Bucket>;
  limit: number;
  windowMs: number;
};

export function createRateLimiter(limit: number, windowMs = 60_000): RateLimiter {
  return { buckets: new Map(), limit, windowMs };
}

/**
 * Fixed-window counter. Returns true if the call is under the limit and
 * increments the count; false if over. `windowStart` resets when the
 * current time is past the window.
 */
export function allow(rl: RateLimiter, key: string, now: number): boolean {
  const bucket = rl.buckets.get(key);
  if (!bucket || now - bucket.windowStart >= rl.windowMs) {
    rl.buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= rl.limit) return false;
  bucket.count++;
  return true;
}
