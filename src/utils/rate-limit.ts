import type { D1Database } from '@cloudflare/workers-types';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number;
}

/**
 * D1-backed sliding-window rate limiter.
 * Records one row per allowed hit; callers should purge stale rows
 * regularly (the daily cleanup cron handles this).
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');

  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND hit_at > ?')
    .bind(key, windowStart)
    .first<{ n: number }>();
  const used = row?.n ?? 0;

  if (used >= limit) {
    const oldest = await db
      .prepare('SELECT MIN(hit_at) AS t FROM rate_hits WHERE key = ? AND hit_at > ?')
      .bind(key, windowStart)
      .first<{ t: string }>();
    const retryAfter = oldest?.t
      ? Math.max(1, Math.ceil((Date.parse(oldest.t.replace(' ', 'T') + 'Z') + windowSeconds * 1000 - Date.now()) / 1000))
      : windowSeconds;
    return { allowed: false, remaining: 0, retryAfter };
  }

  await db.prepare('INSERT INTO rate_hits (key) VALUES (?)').bind(key).run();
  return { allowed: true, remaining: limit - used - 1, retryAfter: 0 };
}

export function rateLimitHeaders(result: RateLimitResult, limit: number): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed) headers['Retry-After'] = String(result.retryAfter);
  return headers;
}
