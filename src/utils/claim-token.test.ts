import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateTransferCode, normalizeTransferCode } from './claim-token.ts';

const GROUPED = /^[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}$/;

describe('generateTransferCode', () => {
  it('produces grouped 16-char codes from the Crockford alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const code = generateTransferCode();
      assert.match(code, GROUPED);
      seen.add(code);
    }
    assert.equal(seen.size, 200);
  });
});

describe('normalizeTransferCode', () => {
  it('accepts lowercase, ungrouped, and spaced input', () => {
    assert.equal(normalizeTransferCode('7kq2-9mxd-4pwa-8zth'), '7KQ2-9MXD-4PWA-8ZTH');
    assert.equal(normalizeTransferCode('7kq29mxd4pwa8zth'), '7KQ2-9MXD-4PWA-8ZTH');
    assert.equal(normalizeTransferCode('  7KQ2 9MXD 4PWA 8ZTH '), '7KQ2-9MXD-4PWA-8ZTH');
  });

  it('rejects ambiguous letters, wrong lengths, and junk', () => {
    assert.equal(normalizeTransferCode('O0Q2-9MXD-4PWA-8ZTH'), '');
    assert.equal(normalizeTransferCode('ILQ2-9MXD-4PWA-8ZTH'), '');
    assert.equal(normalizeTransferCode('7KQ2-9MXD-4PWA'), '');
    assert.equal(normalizeTransferCode(''), '');
    assert.equal(normalizeTransferCode('not a code at all!!!!'), '');
  });

  it('round-trips generated codes', () => {
    for (let i = 0; i < 20; i++) {
      const code = generateTransferCode();
      assert.equal(normalizeTransferCode(code.toLowerCase().replace(/-/g, '')), code);
    }
  });
});
