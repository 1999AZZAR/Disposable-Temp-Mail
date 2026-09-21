-- Disposable Temp Mail D1 Schema
-- Run: wrangler d1 execute disposable-temp-mail-db --file=src/db/schema.sql

CREATE TABLE IF NOT EXISTS inboxes (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Per-inbox retention in days (7/30/90). NULL = kept until manually
  -- removed (messages still capped, see cleanup.ts). The retention purge
  -- uses this instead of any global cutoff, and Renew restarts the
  -- clock by resetting created_at.
  retention_days INTEGER DEFAULT 7
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  inbox_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  subject TEXT DEFAULT '(no subject)',
  body TEXT DEFAULT '',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_address);
CREATE INDEX IF NOT EXISTS idx_messages_received ON messages(inbox_address, received_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_inboxes (
  session_id TEXT NOT NULL,
  inbox_address TEXT NOT NULL,
  PRIMARY KEY (session_id, inbox_address),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_session_inboxes_session ON session_inboxes(session_id);

CREATE TABLE IF NOT EXISTS rate_hits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  hit_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_hits_key ON rate_hits(key, hit_at);

-- Transfer codes: one unguessable claim token per inbox. Presenting the
-- code on another device links the inbox to that device's session, so
-- inboxes roam across devices with no account. Tokens die with the
-- inbox in the retention purge (see cleanup.ts).
CREATE TABLE IF NOT EXISTS inbox_tokens (
  inbox_address TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_inbox_tokens_token ON inbox_tokens(token);
