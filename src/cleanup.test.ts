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

    const r = await purgeExpired(db, 7);
    assert.equal(r.messages, 1);
    assert.equal((await getMessages(db, 'old@example.com')).length, 0);
    assert.equal((await getMessages(db, 'new@example.com')).length, 1);
  });

  it('removes only old inboxes that hold no messages', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('empty-old@example.com', '2020-01-01 00:00:00');
    await s.inbox('busy-old@example.com', '2020-01-01 00:00:00');
    await s.message('m1', 'busy-old@example.com', NOW);

    const r = await purgeExpired(db, 7);
    assert.equal(r.inboxes, 1);
    assert.equal(await getInbox(db, 'empty-old@example.com'), null);
    assert.notEqual(await getInbox(db, 'busy-old@example.com'), null);
  });

  it('drops old sessions with orphan links and stale rate rows', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.session('s-old', '2020-01-01 00:00:00');
    await s.session('s-new', NOW);
    await s.inbox('a@example.com', NOW);
    await s.link('s-old', 'a@example.com');
    await s.rateHit('k', '2020-01-01 00:00:00');

    const r = await purgeExpired(db, 7);
    assert.equal(r.sessions, 1);
    assert.equal(r.rateHits, 1);
    assert.deepEqual(await getSessionInboxes(db, 's-old'), []);
  });

  it('transfer codes die with their expired inbox and survive on active ones', async () => {
    const db = createTestDb();
    const s = seed(db);
    await s.inbox('gone@example.com', '2020-01-01 00:00:00');
    await s.inbox('kept@example.com', '2020-01-01 00:00:00');
    await s.message('m1', 'kept@example.com', NOW);
    const deadCode = await getOrCreateTransferCode(db, 'gone@example.com');
    const liveCode = await getOrCreateTransferCode(db, 'kept@example.com');

    const r = await purgeExpired(db, 7);
    assert.equal(r.tokens, 1);
    assert.equal(await getAddressByTransferCode(db, deadCode), null);
    assert.equal(await getAddressByTransferCode(db, liveCode), 'kept@example.com');
  });
});
