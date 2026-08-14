/**
 * Self-check do backoff de reconexão — sem framework:
 *   npx ts-node src/monitoring/backoff.util.spec.ts
 */
import assert from 'node:assert';
import { nextBackoffMs } from './backoff.util';

assert.equal(nextBackoffMs(1), 5_000);
assert.equal(nextBackoffMs(2), 10_000);
assert.equal(nextBackoffMs(3), 30_000);
assert.equal(nextBackoffMs(4), 60_000);
assert.equal(nextBackoffMs(5), 60_000); // teto
assert.equal(nextBackoffMs(100), 60_000);
assert.equal(nextBackoffMs(0), 5_000);

console.log('backoff.util self-check OK');
