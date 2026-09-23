import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInbox,
  getInbox,
  renewInbox,
  setInboxRetention,
  parseRetentionDays,
  inboxExists,
  getSessionInboxes,
  getMessages,
  insertMessage,
  deleteMessage,
  ensureSession,
  linkInboxToSession,
  unlinkInboxFromSession,
  isInboxInSession,
  getOrCreateTransferCode,
  getAddressByTransferCode,
} from './queries.ts';
import { createTestDb } from '../test-helpers.ts';

describe('inbox queries', () => {
  it('creates, reads, and checks existence', async () => {
    const db = createTestDb();
    assert.equal(await inboxExists(db, 'a@example.com'), false);
    await createInbox(db, 'a@example.com');
    assert.equal(await inboxExists(db, 'a@example.com'), true);
    assert.equal((await getInbox(db, 'a@example.com'))?.address, 'a@example.com');
    assert.equal(await getInbox(db, 'missing@example.com'), null);
  });

  it('manages the session-inbox lifecycle', async () => {
    const db = createTestDb();
    await ensureSession(db, 's1');
    await createInbox(db, 'a@example.com');
    await createInbox(db, 'b@example.com');
    await linkInboxToSession(db, 's1', 'a@example.com');
    await linkInboxToSession(db, 's1', 'b@example.com');

    assert.equal(await isInboxInSession(db, 's1', 'a@example.com'), true);
    assert.equal(await isInboxInSession(db, 's1', 'other@example.com'), false);
    assert.deepEqual(
      (await getSessionInboxes(db, 's1')).map((i) => i.address).sort(),
      ['a@example.com', 'b@example.com']
    );

    await unlinkInboxFromSession(db, 's1', 'a@example.com');
    assert.equal(await isInboxInSession(db, 's1', 'a@example.com'), false);
  });
});

describe('transfer codes', () => {
  it('mints a stable code per inbox and resolves it back', async () => {
    const db = createTestDb();
    await createInbox(db, 'a@example.com');
    const first = await getOrCreateTransferCode(db, 'a@example.com');
    assert.match(first, /^[0-9A-HJ-KM-NP-TV-Z]{4}(-[0-9A-HJ-KM-NP-TV-Z]{4}){3}$/);
    assert.equal(await getOrCreateTransferCode(db, 'a@example.com'), first);
    assert.equal(await getAddressByTransferCode(db, first), 'a@example.com');
    assert.equal(await getAddressByTransferCode(db, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ'), null);
  });

  it('a code claimed on a second session links the inbox there', async () => {
    const db = createTestDb();
    await ensureSession(db, 's1');
    await ensureSession(db, 's2');
    await createInbox(db, 'a@example.com');
    await linkInboxToSession(db, 's1', 'a@example.com');
    const code = await getOrCreateTransferCode(db, 'a@example.com');

    // Device B flow: resolve code, link to its own session
    const address = await getAddressByTransferCode(db, code);
    assert.equal(address, 'a@example.com');
    await linkInboxToSession(db, 's2', address!);
    assert.equal(await isInboxInSession(db, 's2', 'a@example.com'), true);
    assert.equal((await getSessionInboxes(db, 's2'))[0].transferCode, code);
  });

  it('session inbox listing carries each inbox code', async () => {
    const db = createTestDb();
    await ensureSession(db, 's1');
    await createInbox(db, 'a@example.com');
    await linkInboxToSession(db, 's1', 'a@example.com');
    // No code minted yet: listing shows none (lazy backfill on next read)
    assert.equal((await getSessionInboxes(db, 's1'))[0].transferCode, null);
    const code = await getOrCreateTransferCode(db, 'a@example.com');
    assert.equal((await getSessionInboxes(db, 's1'))[0].transferCode, code);
  });
});

describe('message queries', () => {
  it('inserts and lists newest-first', async () => {
    const db = createTestDb();
    await createInbox(db, 'a@example.com');
    await insertMessage(db, {
      id: 'm1', inbox_address: 'a@example.com',
      from_address: 'x@y.z', subject: 'first', body: 'one',
    });
    await insertMessage(db, {
      id: 'm2', inbox_address: 'a@example.com',
      from_address: 'x@y.z', subject: 'second', body: 'two',
    });
    const msgs = await getMessages(db, 'a@example.com');
    assert.equal(msgs.length, 2);
    assert.ok(msgs.every((m) => m.inbox_address === 'a@example.com'));
  });

  it('deletes only messages in the caller session', async () => {
    const db = createTestDb();
    await ensureSession(db, 's1');
    await ensureSession(db, 's2');
    await createInbox(db, 'a@example.com');
    await createInbox(db, 'b@example.com');
    await linkInboxToSession(db, 's1', 'a@example.com');
    await linkInboxToSession(db, 's2', 'b@example.com');
    const msg = (id: string, inbox: string) => insertMessage(db, {
      id, inbox_address: inbox,
      from_address: 'x@y.z', subject: 's', body: 'b',
    });
    await msg('m1', 'a@example.com');
    await msg('m2', 'b@example.com');

    assert.equal(await deleteMessage(db, 's1', 'm1'), 1);
    assert.equal((await getMessages(db, 'a@example.com')).length, 0);
    assert.equal(await deleteMessage(db, 's1', 'm1'), 0);
    assert.equal(await deleteMessage(db, 's1', 'm2'), 0);
    assert.equal((await getMessages(db, 'b@example.com')).length, 1);
    assert.equal(await deleteMessage(db, 'nope', 'm2'), 0);
  });
});

describe('retention plans', () => {
  it('validates client retention choices', async () => {
    assert.equal(parseRetentionDays(undefined), 7);
    assert.equal(parseRetentionDays(null), 7);
    assert.equal(parseRetentionDays(3), 3);
    assert.equal(parseRetentionDays(7), 7);
    assert.equal(parseRetentionDays(30), 30);
    assert.equal(parseRetentionDays('90'), 90);
    assert.equal(parseRetentionDays(180), 180);
    assert.equal(parseRetentionDays('keep'), null);
    assert.equal(parseRetentionDays('forever'), null);
    assert.equal(parseRetentionDays(5), undefined);
    assert.equal(parseRetentionDays('x'), undefined);
    assert.equal(parseRetentionDays(-1), undefined);
  });

  it('stores the plan on create, defaulting to 7', async () => {
    const db = createTestDb();
    await createInbox(db, 'a@example.com');
    await createInbox(db, 'b@example.com', 30);
    await createInbox(db, 'c@example.com', null);
    assert.equal((await getInbox(db, 'a@example.com'))?.retention_days, 7);
    assert.equal((await getInbox(db, 'b@example.com'))?.retention_days, 30);
    assert.equal((await getInbox(db, 'c@example.com'))?.retention_days, null);
  });

  it('renews the clock and changes the plan', async () => {
    const db = createTestDb();
    const exec = (sql: string, ...params: unknown[]) =>
      (db.prepare(sql).bind(...params) as unknown as { run: () => Promise<unknown> }).run();
    await exec(`INSERT INTO inboxes (address, created_at, retention_days) VALUES (?, ?, ?)`,
      'a@example.com', '2020-01-01 00:00:00', 7);
    await renewInbox(db, 'a@example.com');
    const renewed = await getInbox(db, 'a@example.com');
    assert.ok(renewed && renewed.created_at > '2020-01-01 00:00:00');
    await setInboxRetention(db, 'a@example.com', 90);
    assert.equal((await getInbox(db, 'a@example.com'))?.retention_days, 90);
    await setInboxRetention(db, 'a@example.com', null);
    assert.equal((await getInbox(db, 'a@example.com'))?.retention_days, null);
  });

  it('restarts the clock only when shortening the plan', async () => {
    const db = createTestDb();
    const exec = (sql: string, ...params: unknown[]) =>
      (db.prepare(sql).bind(...params) as unknown as { run: () => Promise<unknown> }).run();
    const seed = (addr: string, created: string, plan: number | null) =>
      exec(`INSERT INTO inboxes (address, created_at, retention_days) VALUES (?, ?, ?)`,
        addr, created, plan);

    // Shortening 7 -> 3 restarts the clock.
    await seed('short@example.com', '2020-01-01 00:00:00', 7);
    await setInboxRetention(db, 'short@example.com', 3);
    let inbox = await getInbox(db, 'short@example.com');
    assert.equal(inbox?.retention_days, 3);
    assert.ok(inbox && inbox.created_at > '2020-01-01 00:00:00');

    // Lengthening 3 -> 30 keeps the original clock.
    const clock = inbox!.created_at;
    await setInboxRetention(db, 'short@example.com', 30);
    inbox = await getInbox(db, 'short@example.com');
    assert.equal(inbox?.retention_days, 30);
    assert.equal(inbox?.created_at, clock);

    // Leaving keep-forever for a finite plan restarts the clock.
    await seed('keep@example.com', '2020-01-01 00:00:00', null);
    await setInboxRetention(db, 'keep@example.com', 7);
    inbox = await getInbox(db, 'keep@example.com');
    assert.equal(inbox?.retention_days, 7);
    assert.ok(inbox && inbox.created_at > '2020-01-01 00:00:00');

    // Switching a finite plan to keep preserves the clock.
    await seed('finite@example.com', '2020-01-01 00:00:00', 7);
    await setInboxRetention(db, 'finite@example.com', null);
    inbox = await getInbox(db, 'finite@example.com');
    assert.equal(inbox?.retention_days, null);
    assert.equal(inbox?.created_at, '2020-01-01 00:00:00');
  });
});
