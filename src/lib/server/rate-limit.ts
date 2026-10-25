/**
 * In-memory sliding-window rate limiter. Adequate for a single local or
 * single-instance deployment; use a shared store (e.g. Redis) when running
 * several instances.
 */
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();
/** Upper bound on tracked callers, so the limiter itself cannot exhaust memory. */
const MAX_KEYS = 10_000;

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until another request would be accepted. */
  retryAfter: number;
}

export function rateLimit(bucket: string, key: string, limit: number, windowMs = 60_000, now = Date.now()): RateLimitResult {
  const id = `${bucket}:${key}`;
  const hits = (buckets.get(id) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(id, hits);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(id, hits);

  if (now - lastSweep > windowMs || buckets.size > MAX_KEYS) {
    lastSweep = now;
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
    // Still too many active callers: forget the least recently added ones.
    for (const k of buckets.keys()) {
      if (buckets.size <= MAX_KEYS) break;
      buckets.delete(k);
    }
  }
  return { ok: true, retryAfter: 0 };
}

export function trackedKeys(): number {
  return buckets.size;
}

export function resetRateLimits(): void {
  buckets.clear();
}
