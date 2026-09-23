import type { D1Database } from '@cloudflare/workers-types';
import { generateTransferCode } from '../utils/claim-token.ts';

export interface Inbox {
  address: string;
  created_at: string;
  retention_days: number | null;
  transferCode?: string;
}

export interface Message {
  id: string;
  inbox_address: string;
  from_address: string;
  subject: string;
  body: string;
  body_html?: string;
  received_at: string;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size: number;
  cid: string | null;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mime_type: string;
  size: number;
  cid: string | null;
  inline: boolean;
}

export interface MessageWithAttachments extends Message {
  attachments: AttachmentMeta[];
}

export interface Session {
  id: string;
  created_at: string;
}

// ---- Retention ----

/** Capped choices offered for per-inbox retention (days). */
export const RETENTION_OPTIONS = [7, 30, 90] as const;

/** Server default when the client picks nothing. */
export const DEFAULT_RETENTION_DAYS = 7;

/**
 * Validate a client-supplied retention choice. Returns the day count,
 * null for keep-until-removed, or undefined when the value is invalid.
 */
export function parseRetentionDays(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return DEFAULT_RETENTION_DAYS;
  if (value === 'keep' || value === 'forever' || value === 'until-removed') return null;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if ((RETENTION_OPTIONS as readonly number[]).includes(n)) return n;
  return undefined;
}

// ---- Schema drift ----

/**
 * Idempotent migration for databases created before a schema addition.
 * schema.sql covers fresh installs; this backfills long-lived ones
 * (prod D1) without a manual migrate step. Safe to call on every entry.
 */
export async function ensureSchema(db: D1Database): Promise<void> {
  const cols = await db
    .prepare(`SELECT name FROM pragma_table_info('messages')`)
    .all<{ name: string }>()
    .then((r) => r.results.map((c) => c.name));
  if (!cols.includes('body_html')) {
    await db.prepare(`ALTER TABLE messages ADD COLUMN body_html TEXT DEFAULT ''`).run();
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        size INTEGER NOT NULL DEFAULT 0,
        cid TEXT,
        r2_key TEXT NOT NULL,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      )`
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id)`)
    .run();
}

// ---- Inboxes ----

export async function getInbox(db: D1Database, address: string): Promise<Inbox | null> {
  return db.prepare('SELECT * FROM inboxes WHERE address = ?').bind(address).first<Inbox>();
}

export async function createInbox(
  db: D1Database,
  address: string,
  retentionDays: number | null = DEFAULT_RETENTION_DAYS
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO inboxes (address, retention_days) VALUES (?, ?)')
    .bind(address, retentionDays)
    .run();
}

export async function inboxExists(db: D1Database, address: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM inboxes WHERE address = ? LIMIT 1').bind(address).first();
  return !!row;
}

/** Restart an inbox's retention clock (created_at = now). */
export async function renewInbox(db: D1Database, address: string): Promise<void> {
  await db
    .prepare(`UPDATE inboxes SET created_at = datetime('now') WHERE address = ?`)
    .bind(address)
    .run();
}

/** Change an inbox's retention plan going forward. */
export async function setInboxRetention(
  db: D1Database,
  address: string,
  retentionDays: number | null
): Promise<void> {
  await db
    .prepare('UPDATE inboxes SET retention_days = ? WHERE address = ?')
    .bind(retentionDays, address)
    .run();
}

export async function getSessionInboxes(db: D1Database, sessionId: string): Promise<Inbox[]> {
  return db
    .prepare(
      `SELECT i.*, t.token AS transferCode FROM inboxes i
       INNER JOIN session_inboxes si ON si.inbox_address = i.address
       LEFT JOIN inbox_tokens t ON t.inbox_address = i.address
       WHERE si.session_id = ?
       ORDER BY i.created_at DESC`
    )
    .bind(sessionId)
    .all<Inbox>()
    .then((r) => r.results);
}

// ---- Transfer codes (cross-device claims) ----

/** Fetch the inbox's transfer code, minting one on first use (backfills older inboxes). */
export async function getOrCreateTransferCode(db: D1Database, address: string): Promise<string> {
  const existing = await db
    .prepare('SELECT token FROM inbox_tokens WHERE inbox_address = ?')
    .bind(address)
    .first<{ token: string }>();
  if (existing) return existing.token;

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateTransferCode();
    const done = await db
      .prepare('INSERT OR IGNORE INTO inbox_tokens (inbox_address, token) VALUES (?, ?)')
      .bind(address, token)
      .run();
    if ((done.meta.changes ?? 0) > 0) return token;
    // Collision (or a concurrent mint won the race) — read back whatever is there.
    const raced = await db
      .prepare('SELECT token FROM inbox_tokens WHERE inbox_address = ?')
      .bind(address)
      .first<{ token: string }>();
    if (raced) return raced.token;
  }
  throw new Error('Could not mint transfer code');
}

export async function getAddressByTransferCode(db: D1Database, token: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT inbox_address FROM inbox_tokens WHERE token = ?')
    .bind(token)
    .first<{ inbox_address: string }>();
  return row?.inbox_address ?? null;
}

// ---- Messages ----

export async function getMessages(db: D1Database, inboxAddress: string): Promise<Message[]> {
  return db
    .prepare(
      'SELECT * FROM messages WHERE inbox_address = ? ORDER BY received_at DESC'
    )
    .bind(inboxAddress)
    .all<Message>()
    .then((r) => r.results);
}

export async function insertMessage(
  db: D1Database,
  msg: Omit<Message, 'received_at'>
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages (id, inbox_address, from_address, subject, body, body_html)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(msg.id, msg.inbox_address, msg.from_address, msg.subject, msg.body, msg.body_html || '')
    .run();
}

/** Messages for an inbox, each with its attachment metadata (no bytes). */
export async function getMessagesWithAttachments(
  db: D1Database,
  inboxAddress: string
): Promise<MessageWithAttachments[]> {
  const messages = await getMessages(db, inboxAddress);
  if (!messages.length) return [];
  const ids = messages.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db
    .prepare(
      `SELECT id, message_id, filename, mime_type, size, cid
       FROM attachments WHERE message_id IN (${placeholders})`
    )
    .bind(...ids)
    .all<Attachment>()
    .then((r) => r.results);
  const byMessage = new Map<string, AttachmentMeta[]>();
  for (const a of rows) {
    const list = byMessage.get(a.message_id) || [];
    list.push({ id: a.id, filename: a.filename, mime_type: a.mime_type, size: a.size, cid: a.cid, inline: !!a.cid });
    byMessage.set(a.message_id, list);
  }
  return messages.map((m) => ({ ...m, attachments: byMessage.get(m.id) || [] }));
}

// ---- Attachments ----

export async function insertAttachment(db: D1Database, att: Attachment & { r2_key: string }): Promise<void> {
  await db
    .prepare(
      `INSERT INTO attachments (id, message_id, filename, mime_type, size, cid, r2_key)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(att.id, att.message_id, att.filename, att.mime_type, att.size, att.cid, att.r2_key)
    .run();
}

/** Attachment row only when its message belongs to the session. */
export async function getAttachmentForSession(
  db: D1Database,
  sessionId: string,
  attachmentId: string
): Promise<Attachment & { r2_key: string } | null> {
  return db
    .prepare(
      `SELECT a.* FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       INNER JOIN session_inboxes si ON si.inbox_address = m.inbox_address
       WHERE a.id = ? AND si.session_id = ?`
    )
    .bind(attachmentId, sessionId)
    .first<Attachment & { r2_key: string }>();
}

/** Message HTML only when its inbox belongs to the session. */
export async function getMessageHtmlForSession(
  db: D1Database,
  sessionId: string,
  messageId: string
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT m.body_html FROM messages m
       INNER JOIN session_inboxes si ON si.inbox_address = m.inbox_address
       WHERE m.id = ? AND si.session_id = ?`
    )
    .bind(messageId, sessionId)
    .first<{ body_html: string }>();
  return row ? row.body_html || '' : null;
}
/** R2 keys for a message's attachments (session-scoped), for cleanup on delete. */
export async function attachmentKeysForMessage(
  db: D1Database,
  sessionId: string,
  messageId: string
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT a.r2_key FROM attachments a
       INNER JOIN messages m ON m.id = a.message_id
       INNER JOIN session_inboxes si ON si.inbox_address = m.inbox_address
       WHERE a.message_id = ? AND si.session_id = ?`
    )
    .bind(messageId, sessionId)
    .all<{ r2_key: string }>()
    .then((r) => r.results);
  return rows.map((r) => r.r2_key);
}

export async function deleteMessage(
  db: D1Database,
  sessionId: string,
  messageId: string
): Promise<number> {
  await db
    .prepare(
      `DELETE FROM attachments WHERE message_id = ? AND EXISTS (
         SELECT 1 FROM messages m
         JOIN session_inboxes si ON si.inbox_address = m.inbox_address
         WHERE m.id = ? AND si.session_id = ?
       )`
    )
    .bind(messageId, messageId, sessionId)
    .run();
  const result = await db
    .prepare(
      `DELETE FROM messages WHERE id = ?
       AND inbox_address IN (SELECT inbox_address FROM session_inboxes WHERE session_id = ?)`
    )
    .bind(messageId, sessionId)
    .run();
  return result.meta.changes ?? 0;
}

// ---- Sessions ----

export async function ensureSession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO sessions (id) VALUES (?)').bind(sessionId).run();
}

export async function sessionExists(db: D1Database, sessionId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sessions WHERE id = ? LIMIT 1').bind(sessionId).first();
  return !!row;
}

// ---- Session-Inbox links ----

export async function linkInboxToSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)'
    )
    .bind(sessionId, address)
    .run();
}

export async function unlinkInboxFromSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<void> {
  await db
    .prepare('DELETE FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')
    .bind(sessionId, address)
    .run();
}

export async function isInboxInSession(
  db: D1Database,
  sessionId: string,
  address: string
): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE session_id = ? AND inbox_address = ? LIMIT 1')
    .bind(sessionId, address)
    .first();
  return !!row;
}
