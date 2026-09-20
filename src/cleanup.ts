import type { D1Database } from '@cloudflare/workers-types';

export interface PurgeResult {
  messages: number;
  inboxes: number;
  sessions: number;
  rateHits: number;
}

/**
 * Delete expired data. Dependent session_inboxes links are removed
 * BEFORE their parent sessions/inboxes, so the purge is safe even on
 * databases that enforce foreign keys. Cutoffs are computed in SQL so
 * the cron needs no clock logic of its own. Inboxes are removed only
 * when they hold no messages, so an active address never loses its
 * mailbox early.
 */
export async function purgeExpired(db: D1Database, retentionDays: number): Promise<PurgeResult> {
  const days = Math.max(1, Math.floor(retentionDays) || 7);

  const messages = await db
    .prepare(`DELETE FROM messages WHERE received_at < datetime('now', '-' || ? || ' days')`)
    .bind(days)
    .run();

  // Links to sessions/inboxes that are about to expire — delete first (FK-safe)
  await db
    .prepare(
      `DELETE FROM session_inboxes
       WHERE session_id IN (SELECT id FROM sessions WHERE created_at < datetime('now', '-30 days'))
       OR inbox_address IN (
         SELECT address FROM inboxes
         WHERE created_at < datetime('now', '-' || ? || ' days')
         AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.inbox_address = inboxes.address)
       )`
    )
    .bind(days)
    .run();

  const sessions = await db
    .prepare(`DELETE FROM sessions WHERE created_at < datetime('now', '-30 days')`)
    .run();

  const inboxes = await db
    .prepare(
      `DELETE FROM inboxes
       WHERE created_at < datetime('now', '-' || ? || ' days')
       AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.inbox_address = inboxes.address)`
    )
    .bind(days)
    .run();

  // Safety net for any other orphaned links
  await db
    .prepare(
      `DELETE FROM session_inboxes
       WHERE session_id NOT IN (SELECT id FROM sessions)
       OR inbox_address NOT IN (SELECT address FROM inboxes)`
    )
    .run();

  const rateHits = await db
    .prepare(`DELETE FROM rate_hits WHERE hit_at < datetime('now', '-1 day')`)
    .run();

  return {
    messages: messages.meta.changes ?? 0,
    inboxes: inboxes.meta.changes ?? 0,
    sessions: sessions.meta.changes ?? 0,
    rateHits: rateHits.meta.changes ?? 0,
  };
}
