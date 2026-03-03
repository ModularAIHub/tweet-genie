/**
 * Lightweight in-memory per-user rate limiter.
 *
 * Usage:
 *   import { schedulingRateLimit } from '../middleware/rateLimit.js';
 *   router.put('/:id', schedulingRateLimit, handler);
 *
 * No external dependencies — uses a simple sliding-window counter map
 * that auto-cleans expired entries every 60 s.
 */

const buckets = new Map(); // key → { count, resetAt }

function createRateLimiter({ windowMs = 10_000, max = 8, message } = {}) {
  const msg =
    message || `Too many requests — please wait a few seconds before trying again.`;

  // Periodic cleanup so the Map doesn't grow forever
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000).unref();

  return (req, res, next) => {
    // Identify user — fall back to IP if not authenticated
    const userId = req.user?.id || req.ip;
    const key = `${req.baseUrl}:${userId}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    // Standard rate-limit headers
    const remaining = Math.max(0, max - bucket.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: msg });
    }

    next();
  };
}

// ─── Pre-built limiters ──────────────────────────────────────────────────

/** Scheduling mutations: max 8 requests per 10 s per user */
export const schedulingRateLimit = createRateLimiter({
  windowMs: 10_000,
  max: 8,
  message: 'Slow down! You can reschedule up to 8 times every 10 seconds.',
});

/** Content-review mutations: max 10 requests per 10 s per user */
export const contentReviewRateLimit = createRateLimiter({
  windowMs: 10_000,
  max: 10,
  message: 'Slow down! Too many content-review actions. Please wait a moment.',
});

export { createRateLimiter };
