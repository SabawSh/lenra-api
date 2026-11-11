/**
 * Small in-memory limiter for discount-code previews, so codes cannot be
 * guessed by brute force. Per process; enough for one API instance.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
const MAX_KEYS = 10_000;

const hits = new Map<string, { count: number; resetAt: number }>();

export function previewRateLimitKey(req: Request, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const ip =
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return `ip:${ip}`;
}

/** Returns false when the caller is over the limit. */
export function takePreviewToken(key: string, now = Date.now()): boolean {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    if (hits.size >= MAX_KEYS) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
      if (hits.size >= MAX_KEYS) hits.clear();
    }
    hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= MAX_PER_WINDOW) return false;
  entry.count += 1;
  return true;
}

export function resetPreviewRateLimit(): void {
  hits.clear();
}
