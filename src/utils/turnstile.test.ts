import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTurnstileToken } from './turnstile.ts';

describe('verifyTurnstileToken', () => {
  it('passes everything when no secret is configured (dev bypass)', async () => {
    assert.equal(await verifyTurnstileToken('', undefined), true);
    assert.equal(await verifyTurnstileToken('anything', ''), true);
  });

  it('rejects empty token when secret is set', async () => {
    assert.equal(await verifyTurnstileToken('', 'secret'), false);
  });

  it('accepts success=true from the verify endpoint', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"success":true}', { status: 200 })) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret', '1.2.3.4'), true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('rejects success=false from the verify endpoint', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('{"success":false,"error-codes":["invalid-input-response"]}', { status: 200 })) as typeof fetch;
    try {
      assert.equal(await verifyTurnstileToken('tok', 'secret'), false);
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
      assert.equal(await verifyTurnstileToken('tok', 'secret'), false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
