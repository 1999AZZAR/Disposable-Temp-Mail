import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInbox,
  ensureSession,
  ensureSchema,
  linkInboxToSession,
  insertMessage,
  insertAttachment,
  getMessagesWithAttachments,
  getAttachmentForSession,
  getMessageHtmlForSession,
  attachmentKeysForMessage,
  deleteMessage,
} from './queries.ts';
import { createTestDb } from '../test-helpers.ts';

async function seeded() {
  const db = createTestDb();
  await ensureSchema(db);
  await createInbox(db, 'a@tmail.example.com');
  await createInbox(db, 'b@tmail.example.com');
  await ensureSession(db, 's1');
  await ensureSession(db, 's2');
  await linkInboxToSession(db, 's1', 'a@tmail.example.com');
  await linkInboxToSession(db, 's2', 'b@tmail.example.com');
  await insertMessage(db, {
    id: 'm1', inbox_address: 'a@tmail.example.com', from_address: 'x@y.z',
    subject: 'hi', body: 'plain', body_html: '<p>rich</p>',
  });
  await insertAttachment(db, {
    id: 'att1', message_id: 'm1', filename: 'note.txt',
    mime_type: 'text/plain', size: 5, cid: null, r2_key: 'att/m1/att1',
  });
  return db;
}

describe('attachments', () => {
  it('lists messages with attachment metadata grouped', async () => {
    const db = await seeded();
    const msgs = await getMessagesWithAttachments(db, 'a@tmail.example.com');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].attachments.length, 1);
    assert.equal(msgs[0].attachments[0].filename, 'note.txt');
    assert.equal((await getMessagesWithAttachments(db, 'b@tmail.example.com')).length, 0);
  });

  it('resolves attachment only for the owning session', async () => {
    const db = await seeded();
    const own = await getAttachmentForSession(db, 's1', 'att1');
    assert.equal(own?.r2_key, 'att/m1/att1');
    assert.equal(await getAttachmentForSession(db, 's2', 'att1'), null);
    assert.equal(await getAttachmentForSession(db, 's1', 'nope'), null);
  });

  it('serves html only for the owning session', async () => {
    const db = await seeded();
    assert.equal(await getMessageHtmlForSession(db, 's1', 'm1'), '<p>rich</p>');
    assert.equal(await getMessageHtmlForSession(db, 's2', 'm1'), null);
  });

  it('deleteMessage removes attachment rows and exposes R2 keys first', async () => {
    const db = await seeded();
    const keys = await attachmentKeysForMessage(db, 's1', 'm1');
    assert.deepEqual(keys, ['att/m1/att1']);
    assert.deepEqual(await attachmentKeysForMessage(db, 's2', 'm1'), []);
    assert.equal(await deleteMessage(db, 's1', 'm1'), 1);
    const msgs = await getMessagesWithAttachments(db, 'a@tmail.example.com');
    assert.equal(msgs.length, 0);
  });

  it('ensureSchema backfills body_html on legacy databases', async () => {
    const db = createTestDb();
    await db.prepare('ALTER TABLE messages DROP COLUMN body_html').run().catch(() => {});
    await ensureSchema(db);
    const cols = await db.prepare(`SELECT name FROM pragma_table_info('messages')`)
      .all<{ name: string }>().then((r) => r.results.map((c) => c.name));
    assert.ok(cols.includes('body_html'));
  });
});
