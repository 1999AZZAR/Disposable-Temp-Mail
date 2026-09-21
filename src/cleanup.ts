import type { D1Database } from '@cloudflare/workers-types';

export interface PurgeResult {
  messages: number;
  inboxes: number;
  sessions: number;
  rateHits: number;
  tokens: number;
}

/**
 * Cap (days) on message age inside keep-until-removed inboxes. The address
 * itself never expires, but D1 is not an archive — old mail still ages out.
 */
export const KEEP_MESSAGE_CAP_DAYS = 90;

/**
 * Delete expired data. Dependent session_inboxes links and transfer-code
 * tokens are removed BEFORE their parent sessions/inboxes, so the purge
 * is safe even on databases that enforce foreign keys. Cutoffs are
 * computed in SQL so the cron needs no clock logic of its own.
 *
 * Retention is per-inbox (`inboxes.retention_days`): an inbox is removed
 * only once it is older than its own plan AND holds no messages, so an
 * active address never loses its mailbox early. NULL retention means
 * keep-until-removed — the address survives, its messages age out after
 * KEEP_MESSAGE_CAP_DAYS. The `retentionDays` argument is only a fallback
 * for orphaned rows whose parent inbox is gone.
 */
export async function purgeExpired(db: D1Database, retentionDays: number): Promise<PurgeResult> {
  const days = Math.max(1, Math.floor(retentionDays) || 7);

  // Messages age out per their parent inbox's plan (keep-forever capped).
  const messages = await db
    .prepare(
      `DELETE FROM messages
       WHERE received_at < (
         SELECT datetime('now', '-' || COALESCE(
           (SELECT COALESCE(retention_days, ${KEEP_MESSAGE_CAP_DAYS}) FROM inboxes WHERE address = messages.inbox_address),
           ?
         ) || ' days')
       )`
    )
    .bind(days)
    .run();

  // Inboxes past their own plan with no messages left.
  const expiredInbox = `SELECT address FROM inboxes
       WHERE retention_days IS NOT NULL
       AND created_at < datetime('now', '-' || retention_days || ' days')
       AND NOT EXISTS (SELECT 1 FROM messages WHERE messages.inbox_address = inboxes.address)`;

  // Links to sessions/inboxes that are about to expire — delete first (FK-safe)
  await db
    .prepare(
      `DELETE FROM session_inboxes
       WHERE session_id IN (SELECT id FROM sessions WHERE created_at < datetime('now', '-30 days'))
       OR inbox_address IN (${expiredInbox})`
    )
    .run();

  // Transfer codes die with the inboxes they belong to
  const tokens = await db
    .prepare(`DELETE FROM inbox_tokens WHERE inbox_address IN (${expiredInbox})`)
    .run();

  const sessions = await db
    .prepare(`DELETE FROM sessions WHERE created_at < datetime('now', '-30 days')`)
    .run();

  const inboxes = await db.prepare(`DELETE FROM inboxes WHERE address IN (${expiredInbox})`).run();

  // Safety net for any other orphaned links
  await db
    .prepare(
      `DELETE FROM session_inboxes
       WHERE session_id NOT IN (SELECT id FROM sessions)
       OR inbox_address NOT IN (SELECT address FROM inboxes)`
    )
    .run();

  await db
    .prepare(
      `DELETE FROM inbox_tokens
       WHERE inbox_address NOT IN (SELECT address FROM inboxes)`
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
    tokens: tokens.meta.changes ?? 0,
  };
}
