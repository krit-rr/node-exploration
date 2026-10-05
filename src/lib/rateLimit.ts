/**
 * Minimal fixed-window rate limiter, in-memory per server instance.
 *
 * On serverless hosting each warm instance keeps its own counters, so the
 * effective global limit is (limit x instances) — still enough to stop one
 * user hammering the paid OpenAI paths from a single session. Swap for a
 * shared store (e.g. Upstash) when real multi-instance limits are needed.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number }
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = windows.get(key);

  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_KEYS) {
      // Evict expired windows before refusing to grow
      for (const [k, w] of windows) {
        if (w.resetAt <= now) windows.delete(k);
      }
    }
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  current.count += 1;
  if (current.count > limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  return { ok: true, retryAfterSeconds: 0 };
}
