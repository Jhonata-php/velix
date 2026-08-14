/**
 * Self-check da detecção de token FCM inválido — sem framework:
 *   npx ts-node src/push/push.util.spec.ts
 */
import assert from 'node:assert';
import { collectInvalidTokens } from './push.util';

const tokens = ['token-a', 'token-b', 'token-c'];
const responses = [
  { success: true },
  { success: false, error: { code: 'messaging/registration-token-not-registered' } },
  { success: false, error: { code: 'messaging/internal-error' } }, // erro transitório, não remove o token
];

assert.deepEqual(collectInvalidTokens(tokens, responses), ['token-b']);
assert.deepEqual(collectInvalidTokens([], []), []);
assert.deepEqual(collectInvalidTokens(['t1'], [{ success: true }]), []);

console.log('push.util self-check OK');
