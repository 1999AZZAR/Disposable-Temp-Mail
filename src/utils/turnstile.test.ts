import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstileToken } from './turnstile.ts';

const HOST = 'tmail.hela.my.id';

describe('verifyTurnstileToken', () => {
  it('passes everything when no secret is configured (dev bypass)', async () => {
    assert.equal(await verifyTurnstileToken('', undefined), true);
    assert.equal(await verifyTurnstileToken('anything', ''), true);
  });

  it('rejects empty or oversized token when secret is set', async () => {
    assert.equal(await verifyTurnstileToken('', 'secret', HOST), false);
    assert.equal(await verifyTurnstileToken('x'.repeat(2049), 'secret', HOST), false);
  });

  it('fails closed when no expected hostname is given', async () => {
    assert.equal(await verifyTurnstileToken('tok', 'secret'), false);
  });

  it('accepts success=true with matching hostname', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, hostname: HOST }), { status: 200 })) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret', HOST, '1.2.3.4'), true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects success=true with foreign hostname (replay from another site)', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: true, hostname: 'evil.example' }), { status: 200 })) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret', HOST), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects success=false from the verify endpoint', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"success":false,"error-codes":["invalid-input-response"]}', { status: 200 })) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret', HOST), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('fails closed on network error', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('down');
    }) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret', HOST), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
