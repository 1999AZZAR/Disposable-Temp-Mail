import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface PurgeResult {
  messages: number;
  inboxes: number;
  sessions: number;
  rateHits: number;
  tokens: number;
  attachments: number;
}

/**
 * Ledger TTL (days): every ledger entry is deleted this long after it
 * arrives, regardless of its address's retention plan. The address clock
 * and the ledger clock are independent — a keep-forever address keeps
 * working, but no single message lives here longer than this. Bounds D1
 * growth so the archive can't explode.
 */
export const LEDGER_TTL_DAYS = 90;

/**
 * Delete expired data. Dependent session_inboxes links and transfer-code
 * tokens are removed BEFORE their parent sessions/inboxes, so the purge
 * is safe even on databases that enforce foreign keys. Cutoffs are
 * computed in SQL so the cron needs no clock logic of its own.
 *
 * Two independent clocks:
 * - Ledger: every message older than LEDGER_TTL_DAYS is deleted, on any
 *   plan. R2 attachment bytes go with their message.
 * - Addresses: an inbox is removed only once it is older than its own
 *   plan (`inboxes.retention_days`) AND holds no messages, so an active
 *   address never loses its mailbox early. NULL retention means
 *   keep-until-removed — the address survives while its mail still ages
 *   out on the ledger clock.
 */
export async function purgeExpired(
  db: D1Database,
  bucket?: R2Bucket
): Promise<PurgeResult> {
  // Ledger entries age out purely by arrival time — same rule on every plan.
  // Select ids first so attachment bytes in R2 can go with them.
  let messageIds: string[] = [];
  let messagesDeleted = 0;
  let attachments = 0;
  for (;;) {
    const batch = await db
      .prepare(`SELECT id FROM messages WHERE received_at < datetime('now', '-' || ? || ' days') LIMIT 200`)
      .bind(LEDGER_TTL_DAYS)
      .all<{ id: string }>()
      .then((r) => r.results);
    if (!batch.length) break;
    messageIds = batch.map((m) => m.id);
    const placeholders = messageIds.map(() => '?').join(',');
    const keys = await db
      .prepare(`SELECT r2_key FROM attachments WHERE message_id IN (${placeholders})`)
      .bind(...messageIds)
      .all<{ r2_key: string }>()
      .then((r) => r.results);
    if (bucket) await bucket.delete(keys.map((k) => k.r2_key));
    attachments += keys.length;
    await db.prepare(`DELETE FROM attachments WHERE message_id IN (${placeholders})`).bind(...messageIds).run();
    const gone = await db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).bind(...messageIds).run();
    messagesDeleted += gone.meta.changes ?? 0;
  }

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
    messages: messagesDeleted,
    inboxes: inboxes.meta.changes ?? 0,
    sessions: sessions.meta.changes ?? 0,
    rateHits: rateHits.meta.changes ?? 0,
    tokens: tokens.meta.changes ?? 0,
    attachments,
  };
}
