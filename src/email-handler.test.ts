import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleEmail } from './email-handler.ts';
import { createTestDb } from './test-helpers.ts';
import { getMessages, getMessagesWithAttachments } from './db/queries.ts';

function fakeBucket() {
  const store = new Map<string, { body: unknown }>();
  return {
    store,
    async put(key: string, body: unknown) { store.set(key, { body }); },
    async get(key: string) { return store.has(key) ? { body: store.get(key)!.body } : null; },
    async delete(keys: string[]) { for (const k of keys) store.delete(k); },
  };
}

const EML = (subject: string) =>
  [
    'From: Alice <alice@example.org>',
    'To: Test@Tmail.Example.com',
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello there',
    '',
  ].join('\r\n');

function fakeMessage(raw: string) {
  return {
    to: 'Test@Tmail.Example.com',
    from: 'Alice@Example.Org',
    raw,
  } as unknown as ForwardableEmailMessage;
}

describe('handleEmail', () => {
  it('stores a parsed message and auto-creates the inbox lowercased', async () => {
    const db = createTestDb();
    await handleEmail(fakeMessage(EML('Hello')), { DB: db, MAIL_DOMAIN: 'example.com' });

    const msgs = await getMessages(db, 'test@tmail.example.com');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].subject, 'Hello');
    assert.equal(msgs[0].from_address, 'alice@example.org');
    assert.match(msgs[0].body, /Hello there/);
  });

  it('falls back to (no subject) when missing', async () => {
    const db = createTestDb();
    const raw = [
      'From: bob@example.org',
      'To: x@tmail.example.com',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'no subject here',
      '',
    ].join('\r\n');
    await handleEmail(
      { to: 'x@tmail.example.com', from: 'bob@example.org', raw } as unknown as ForwardableEmailMessage,
      { DB: db, MAIL_DOMAIN: 'example.com' }
    );
    assert.equal((await getMessages(db, 'x@tmail.example.com'))[0].subject, '(no subject)');
  });

  it('never throws on malformed input', async () => {
    const db = createTestDb();
    await handleEmail(fakeMessage('this is not an email'), {
      DB: db,
      MAIL_DOMAIN: 'example.com',
    });
  });

  it('stores sanitized html (scripts and handlers removed)', async () => {
    const db = createTestDb();
    const raw = [
      'From: alice@example.org',
      'To: h@tmail.example.com',
      'Subject: Rich',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="b2"',
      '',
      '--b2',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'plain fallback',
      '--b2',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p onclick="evil()">Hello <b>rich</b></p><script>alert(1)</script><a href="javascript:x">y</a>',
      '--b2--',
      '',
    ].join('\r\n');
    await handleEmail(
      { to: 'h@tmail.example.com', from: 'alice@example.org', raw } as unknown as ForwardableEmailMessage,
      { DB: db, MAIL_DOMAIN: 'example.com' }
    );
    const msgs = await getMessages(db, 'h@tmail.example.com');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].body, 'plain fallback');
    assert.ok(msgs[0].body_html!.includes('<b>rich</b>'));
    assert.ok(!msgs[0].body_html!.includes('script'));
    assert.ok(!msgs[0].body_html!.includes('onclick'));
    assert.ok(!msgs[0].body_html!.includes('javascript'));
  });

  it('stores attachments in R2 with D1 metadata', async () => {
    const db = createTestDb();
    const bucket = fakeBucket();
    const raw = [
      'From: alice@example.org',
      'To: f@tmail.example.com',
      'Subject: Files',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b3"',
      '',
      '--b3',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'see attached',
      '--b3',
      'Content-Type: text/plain; name="note.txt"',
      'Content-Disposition: attachment; filename="note.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--b3--',
      '',
    ].join('\r\n');
    await handleEmail(
      { to: 'f@tmail.example.com', from: 'alice@example.org', raw } as unknown as ForwardableEmailMessage,
      { DB: db, MAIL_DOMAIN: 'example.com', ATTACHMENTS: bucket as never }
    );
    const msgs = await getMessagesWithAttachments(db, 'f@tmail.example.com');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].attachments.length, 1);
    assert.equal(msgs[0].attachments[0].filename, 'note.txt');
    assert.equal(msgs[0].attachments[0].size, 5);
    assert.equal(bucket.store.size, 1);
  });

  it('skips attachments when no bucket is bound', async () => {
    const db = createTestDb();
    const raw = [
      'From: alice@example.org',
      'To: g@tmail.example.com',
      'Subject: Files',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b4"',
      '',
      '--b4',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'see attached',
      '--b4',
      'Content-Type: text/plain; name="note.txt"',
      'Content-Disposition: attachment; filename="note.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      'aGVsbG8=',
      '--b4--',
      '',
    ].join('\r\n');
    await handleEmail(
      { to: 'g@tmail.example.com', from: 'alice@example.org', raw } as unknown as ForwardableEmailMessage,
      { DB: db, MAIL_DOMAIN: 'example.com' }
    );
    const msgs = await getMessagesWithAttachments(db, 'g@tmail.example.com');
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].attachments.length, 0);
  });
});
