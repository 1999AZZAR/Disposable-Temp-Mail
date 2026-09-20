import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateUniqueAddress } from './random-address.ts';

describe('generateUniqueAddress', () => {
  it('returns an address at the requested domain', async () => {
    const addr = await generateUniqueAddress(async () => false, 'example.com');
    assert.match(addr, /^[a-z0-9]+@example\.com$/);
  });

  it('retries on collision and returns a free address', async () => {
    let calls = 0;
    const addr = await generateUniqueAddress(async () => ++calls === 1, 'example.com');
    assert.equal(calls, 2);
    assert.match(addr, /@example\.com$/);
  });

  it('throws when the namespace is exhausted', async () => {
    await assert.rejects(
      generateUniqueAddress(async () => true, 'example.com'),
      /Failed to generate unique inbox address/
    );
  });
});
