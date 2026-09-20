import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleEmail } from './email-handler.ts';
import { createTestDb } from './test-helpers.ts';
import { getMessages } from './db/queries.ts';

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
});
