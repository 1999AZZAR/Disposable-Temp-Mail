import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInbox,
  getInbox,
  inboxExists,
  getSessionInboxes,
  getMessages,
  insertMessage,
  ensureSession,
  linkInboxToSession,
  unlinkInboxFromSession,
  isInboxInSession,
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
});
