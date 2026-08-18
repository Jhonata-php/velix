/** Self-check: npx ts-node src/traefik/dns.util.spec.ts */
import assert from 'node:assert';
import { evaluateDnsState } from './dns.util';

assert.equal(evaluateDnsState([], '1.2.3.4'), 'NOT_CONFIGURED');
assert.equal(evaluateDnsState(['1.2.3.4'], null), 'NOT_CONFIGURED');
assert.equal(evaluateDnsState(['1.2.3.4'], '1.2.3.4'), 'CORRECT');
assert.equal(evaluateDnsState(['9.9.9.9'], '1.2.3.4'), 'INCORRECT');
assert.equal(evaluateDnsState(['9.9.9.9', '1.2.3.4'], '1.2.3.4'), 'CORRECT');

// --- proxy da Cloudflare: IPs reais vistos num domínio proxied de verdade ---
// (nuvem laranja) não deve dar INCORRECT mesmo sem bater com o IP do servidor.
assert.equal(evaluateDnsState(['104.21.47.41', '172.67.144.112'], '163.176.72.46'), 'CORRECT');
assert.equal(evaluateDnsState(['2606:4700:3032::6815:2f29', '2606:4700:3030::ac43:9070'], '163.176.72.46'), 'CORRECT');
// IP fora de qualquer faixa da Cloudflare e fora do esperado continua incorreto
assert.equal(evaluateDnsState(['8.8.8.8'], '163.176.72.46'), 'INCORRECT');
// borda da faixa 104.16.0.0/13 (104.16.0.0–104.23.255.255)
assert.equal(evaluateDnsState(['104.16.0.0'], '1.2.3.4'), 'CORRECT');
assert.equal(evaluateDnsState(['104.23.255.255'], '1.2.3.4'), 'CORRECT');
assert.equal(evaluateDnsState(['104.24.0.0'], '1.2.3.4'), 'CORRECT', '104.24.0.0/14 é outra faixa da Cloudflare, também válida');
assert.equal(evaluateDnsState(['104.15.255.255'], '1.2.3.4'), 'INCORRECT', 'um endereço antes da faixa não pode contar como Cloudflare');

console.log('dns.util self-check OK');
