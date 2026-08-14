/**
 * Self-check do parser de métricas (agora com CPU/temperatura) — sem
 * framework: npx ts-node src/servers/metrics.util.spec.ts
 */
import assert from 'node:assert';
import { parseMetrics } from './metrics.util';

const output = [
  'UPTIME: 10:00:00 up 5 days,  2:30,  1 user,  load average: 0.52, 0.58, 0.59',
  'MEM:7975 3210',
  'DISK:50G 20G 42%',
  'CPU:37',
  'TEMP:45.0',
].join('\n');

const metrics = parseMetrics(output);
assert.deepEqual(metrics.loadAvg, [0.52, 0.58, 0.59]);
assert.equal(metrics.memTotalMb, 7975);
assert.equal(metrics.memUsedMb, 3210);
assert.equal(metrics.diskPercent, '42%');
assert.equal(metrics.cpuPercent, 37);
assert.equal(metrics.temperatureCelsius, 45.0);

// servidor sem lm-sensors instalado: TEMP vem vazio, não deve quebrar nem
// virar 0 (0°C seria um dado errado, não "não disponível")
const withoutSensors = parseMetrics(['UPTIME: up', 'MEM:7975 3210', 'DISK:50G 20G 42%', 'CPU:12', 'TEMP:'].join('\n'));
assert.equal(withoutSensors.cpuPercent, 12);
assert.equal(withoutSensors.temperatureCelsius, null);

console.log('metrics.util self-check OK');
