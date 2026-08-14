/**
 * Self-check das funções puras de amostragem contínua — sem framework:
 *   npx ts-node src/monitoring/metrics-sample.util.spec.ts
 */
import assert from 'node:assert';
import { parseSampleLine, computeCpuPercent, computeMemoryPercent, RawSample } from './metrics-sample.util';

// --- parseSampleLine ---------------------------------------------------

const line1 = 'VELIX_SAMPLE cpu_total=1000 cpu_idle=800 mem_total_kb=8000000 mem_avail_kb=4000000 temp_c=45.5';
const sample1 = parseSampleLine(line1);
assert.ok(sample1);
assert.equal(sample1!.cpuTotal, 1000);
assert.equal(sample1!.cpuIdle, 800);
assert.equal(sample1!.memTotalKb, 8000000);
assert.equal(sample1!.memAvailKb, 4000000);
assert.equal(sample1!.temperatureCelsius, 45.5);

// sem sensor de temperatura (campo vazio no shell)
const line2 = 'VELIX_SAMPLE cpu_total=2000 cpu_idle=1900 mem_total_kb=8000000 mem_avail_kb=6000000 temp_c=';
const sample2 = parseSampleLine(line2);
assert.ok(sample2);
assert.equal(sample2!.temperatureCelsius, null);

// linha que não é uma amostra (ex.: ruído do shell) — ignorada
assert.equal(parseSampleLine('bash: sensors: command not found'), null);
assert.equal(parseSampleLine(''), null);

console.log('parseSampleLine self-check OK');

// --- computeCpuPercent --------------------------------------------------

// sem amostra anterior, não dá pra calcular delta
assert.equal(computeCpuPercent(null, sample1!), null);

const prev: RawSample = { cpuTotal: 1000, cpuIdle: 800, memTotalKb: null, memAvailKb: null, temperatureCelsius: null };
const current: RawSample = { cpuTotal: 1100, cpuIdle: 850, memTotalKb: null, memAvailKb: null, temperatureCelsius: null };
// total avançou 100, idle avançou 50 -> 50% de uso no intervalo
assert.equal(computeCpuPercent(prev, current), 50);

// contador não avançou (amostra repetida) -> sem delta válido
assert.equal(computeCpuPercent(prev, prev), null);

console.log('computeCpuPercent self-check OK');

// --- computeMemoryPercent ------------------------------------------------

assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: 8000000, memAvailKb: 2000000, temperatureCelsius: null }), 75);
assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: null, memAvailKb: 2000000, temperatureCelsius: null }), null);
assert.equal(computeMemoryPercent({ cpuTotal: 0, cpuIdle: 0, memTotalKb: 0, memAvailKb: 0, temperatureCelsius: null }), null);

console.log('computeMemoryPercent self-check OK');
