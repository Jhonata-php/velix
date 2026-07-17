/** Self-check: npx ts-node src/traefik/dns.util.spec.ts */
import assert from 'node:assert';
import { evaluateDnsState } from './dns.util';

assert.equal(evaluateDnsState([], '1.2.3.4'), 'NOT_CONFIGURED');
assert.equal(evaluateDnsState(['1.2.3.4'], null), 'NOT_CONFIGURED');
assert.equal(evaluateDnsState(['1.2.3.4'], '1.2.3.4'), 'CORRECT');
assert.equal(evaluateDnsState(['9.9.9.9'], '1.2.3.4'), 'INCORRECT');
assert.equal(evaluateDnsState(['9.9.9.9', '1.2.3.4'], '1.2.3.4'), 'CORRECT');

console.log('dns.util self-check OK');
