import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { D1Database } from '@cloudflare/workers-types';
import { purgeExpired } from './cleanup.ts';
import { createTestDb } from './test-helpers.ts';
import { getMessages, getInbox, getSessionInboxes, getOrCreateTransferCode, getAddressByTransferCode } from './db/queries.ts';

const NOW = new Date().toISOString().slice(0, 19).replace('T', ' ');

function seed(db: D1Database) {
  const exec = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).bind(...params) as unknown as { run: () => Promise<unknown> }).run();
  return {
    inbox: (addr: string, created: string) =>
      exec(`INSERT INTO inboxes (address, created_at) VALUES (?, ?)`, addr, created),
    inboxR: (addr: string, created: string, retention: number | null) =>
      exec(`INSERT INTO inboxes (address, created_at, retention_days) VALUES (?, ?, ?)`, addr, created, retention),
    message: (id: string, addr: string, received: string) =>
      exec(
        `INSERT INTO messages (id, inbox_address, from_address, subject, body, received_at)
         VALUES (?, ?, 's@t.u', 'sub', 'body', ?)`,
        id, addr, received
      ),
    session: (id: string, created: string) =>
      exec(`INSERT INTO sessions (id, created_at) VALUES (?, ?)`, id, created),
    link: (sid: string, addr: string) =>
      exec(`INSERT INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)`, sid, addr),
    rateHit: (key: string, at: string) =>
      exec(`INSERT INTO rate_hits (key, hit_at) VALUES (?, ?)`, key, at),
  };
}

describe('purgeExpired', () => {
  it('deletes old messages, keeps fresh ones', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('old@example.com', '2020-01-01 00:00:00');
    await s.inbox('new@example.com', NOW);
    await s.message('m-old', 'old@example.com', '2020-01-01 00:00:00');
    await s.message('m-new', 'new@example.com', NOW);

    const r = await purgeExpired(db);
    assert.equal(r.messages, 1);
    assert.equal((await getMessages(db, 'old@example.com')).length, 0);
    assert.equal((await getMessages(db, 'new@example.com')).length, 1);
  });

  it('expired inboxes take their ledger with them', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('empty-old@example.com', '2020-01-01 00:00:00');
    await s.inbox('busy-old@example.com', '2020-01-01 00:00:00');
    await s.message('m1', 'busy-old@example.com', NOW);

    const r = await purgeExpired(db);
    assert.equal(r.inboxes, 2);
    assert.equal(r.messages, 1);
    assert.equal(await getInbox(db, 'empty-old@example.com'), null);
    assert.equal(await getInbox(db, 'busy-old@example.com'), null);
    assert.deepEqual(await getMessages(db, 'busy-old@example.com'), []);
  });

  it('drops old sessions with orphan links and stale rate rows', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.session('s-old', '2020-01-01 00:00:00');
    await s.session('s-new', NOW);
    await s.inbox('a@example.com', NOW);
    await s.link('s-old', 'a@example.com');
    await s.rateHit('k', '2020-01-01 00:00:00');

    const r = await purgeExpired(db);
    assert.equal(r.sessions, 1);
    assert.equal(r.rateHits, 1);
    assert.deepEqual(await getSessionInboxes(db, 's-old'), []);
  });

  it('transfer codes die with their expired inbox and survive on active ones', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('gone@example.com', '2020-01-01 00:00:00');
    await s.inbox('kept@example.com', NOW);
    await s.message('m1', 'kept@example.com', NOW);
    const deadCode = await getOrCreateTransferCode(db, 'gone@example.com');
    const liveCode = await getOrCreateTransferCode(db, 'kept@example.com');

    const r = await purgeExpired(db);
    assert.equal(r.tokens, 1);
    assert.equal(await getAddressByTransferCode(db, deadCode), null);
    assert.equal(await getAddressByTransferCode(db, liveCode), 'kept@example.com');
  });

  it('removes attachment rows and R2 bytes with expired messages', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('old@example.com', '2020-01-01 00:00:00');
    await s.message('m-old', 'old@example.com', '2020-01-01 00:00:00');
    await (db.prepare(
      `INSERT INTO attachments (id, message_id, filename, mime_type, size, cid, r2_key)
       VALUES ('att1', 'm-old', 'f.bin', 'application/octet-stream', 3, NULL, 'att/m-old/att1')`
    ) as unknown as { run: () => Promise<unknown> }).run();
    const deletedKeys: string[] = [];
    const bucket = { delete: async (keys: string[]) => { deletedKeys.push(...keys); } };

    const r = await purgeExpired(db, bucket as never);
    assert.equal(r.messages, 1);
    assert.equal(r.attachments, 1);
    assert.deepEqual(deletedKeys, ['att/m-old/att1']);
    const leftovers = await db.prepare('SELECT id FROM attachments')
      .all<{ id: string }>().then((x) => x.results);
    assert.deepEqual(leftovers, []);
  });
});

describe('per-inbox retention', () => {
  const ago = (days: number) =>
    new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  it('purges by each inbox plan; keep-forever survives', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inboxR('week@example.com', ago(10), 7);
    await s.inboxR('month@example.com', ago(30), 90);
    await s.inboxR('keep@example.com', ago(100), null);

    const r = await purgeExpired(db);
    assert.equal(r.inboxes, 1);
    assert.equal(await getInbox(db, 'week@example.com'), null);
    assert.notEqual(await getInbox(db, 'month@example.com'), null);
    assert.notEqual(await getInbox(db, 'keep@example.com'), null);
  });

  it('ledger entries die 90 days after arrival on any plan', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inboxR('week@example.com', NOW, 7);
    await s.inboxR('quarter@example.com', NOW, 90);
    await s.inboxR('keep@example.com', NOW, null);
    await s.message('m-week-old', 'week@example.com', ago(100));
    await s.message('m-week-young', 'week@example.com', ago(20));
    await s.message('m-quarter-old', 'quarter@example.com', ago(100));
    await s.message('m-keep-old', 'keep@example.com', ago(100));
    await s.message('m-keep-fresh', 'keep@example.com', ago(30));

    const r = await purgeExpired(db);
    assert.equal(r.messages, 3);
    assert.deepEqual((await getMessages(db, 'week@example.com')).map((m) => m.id), ['m-week-young']);
    assert.deepEqual((await getMessages(db, 'quarter@example.com')).map((m) => m.id), []);
    assert.deepEqual((await getMessages(db, 'keep@example.com')).map((m) => m.id), ['m-keep-fresh']);
  });
});
