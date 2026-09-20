import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit } from './rate-limit.ts';
import { createTestDb } from '../test-helpers.ts';

describe('checkRateLimit', () => {
  it('allows hits up to the limit, then blocks', async () => {
    const db = createTestDb();
    const first = await checkRateLimit(db, 'k1', 3, 3600);
    assert.equal(first.allowed, true);
    assert.equal(first.remaining, 2);

    await checkRateLimit(db, 'k1', 3, 3600);
    const last = await checkRateLimit(db, 'k1', 3, 3600);
    assert.equal(last.allowed, true);
    assert.equal(last.remaining, 0);

    const blocked = await checkRateLimit(db, 'k1', 3, 3600);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);
    assert.ok(blocked.retryAfter > 0);
  });

  it('tracks keys independently', async () => {
    const db = createTestDb();
    await checkRateLimit(db, 'a', 1, 3600);
    assert.equal((await checkRateLimit(db, 'a', 1, 3600)).allowed, false);
    assert.equal((await checkRateLimit(db, 'b', 1, 3600)).allowed, true);
  });

  it('slides the window: expired hits stop counting', async () => {
    const db = createTestDb();
    await checkRateLimit(db, 'w', 1, 1);
    assert.equal((await checkRateLimit(db, 'w', 1, 1)).allowed, false);
    await new Promise((r) => setTimeout(r, 1100));
    assert.equal((await checkRateLimit(db, 'w', 1, 1)).allowed, true);
  });
});
