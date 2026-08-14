/**
 * Self-check da resolução de limite efetivo (servidor > global > nenhum) —
 * sem framework: npx ts-node src/monitoring/threshold-resolver.util.spec.ts
 */
import assert from 'node:assert';
import { resolveThresholdsForServer, ThresholdPreferenceRow } from './threshold-resolver.util';

function row(partial: Partial<ThresholdPreferenceRow> & { userId: string }): ThresholdPreferenceRow {
  return {
    serverId: null,
    cpuPercent: null,
    memoryPercent: null,
    temperatureCelsius: null,
    dockerScope: 'all',
    dockerEnabled: true,
    ...partial,
  };
}

// usuário só com preferência global -> usa a global
const onlyGlobal = [row({ userId: 'u1', cpuPercent: 80 })];
const resolved1 = resolveThresholdsForServer(onlyGlobal, 'srv-1');
assert.equal(resolved1.length, 1);
assert.equal(resolved1[0].cpuPercent, 80);

// usuário com global E override pro servidor -> override vence
const globalAndOverride = [
  row({ userId: 'u2', cpuPercent: 80 }),
  row({ userId: 'u2', serverId: 'srv-1', cpuPercent: 95 }),
];
const resolved2 = resolveThresholdsForServer(globalAndOverride, 'srv-1');
assert.equal(resolved2.length, 1);
assert.equal(resolved2[0].cpuPercent, 95);

// mesmo caso com ordem invertida: override PRIMEIRO, depois global -> override ainda vence
const globalAndOverrideReversed = [
  row({ userId: 'u7', serverId: 'srv-1', cpuPercent: 95 }),
  row({ userId: 'u7', cpuPercent: 80 }),
];
const resolved2b = resolveThresholdsForServer(globalAndOverrideReversed, 'srv-1');
assert.equal(resolved2b.length, 1);
assert.equal(resolved2b[0].cpuPercent, 95);

// preferência é de outro servidor -> não entra pro srv-1
const otherServerOnly = [row({ userId: 'u3', serverId: 'srv-2', cpuPercent: 70 })];
assert.equal(resolveThresholdsForServer(otherServerOnly, 'srv-1').length, 0);

// dois usuários independentes, cada um com sua própria resolução
const mixed = [
  row({ userId: 'u4', cpuPercent: 60 }),
  row({ userId: 'u5', serverId: 'srv-1', memoryPercent: 90 }),
];
const resolvedMixed = resolveThresholdsForServer(mixed, 'srv-1');
assert.equal(resolvedMixed.length, 2);
assert.ok(resolvedMixed.find((r) => r.userId === 'u4' && r.cpuPercent === 60));
assert.ok(resolvedMixed.find((r) => r.userId === 'u5' && r.memoryPercent === 90));

// dockerScope desconhecido cai pro default seguro 'all'
const unknownScope = [row({ userId: 'u6', dockerScope: 'algo-invalido' })];
assert.equal(resolveThresholdsForServer(unknownScope, 'srv-1')[0].dockerScope, 'all');

console.log('threshold-resolver.util self-check OK');
