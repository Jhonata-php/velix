/**
 * Self-check do ServerWatcher com uma implementação fake de SSH (sem
 * conexão real) — npx ts-node src/monitoring/server-watcher.spec.ts
 */
import assert from 'node:assert';
import { ServerWatcher, ServerWatcherSsh } from './server-watcher';
import { RawSample } from './metrics-sample.util';
import { NormalizedDockerEvent } from './docker-event.util';

// --- reconecta depois que a conexão cai, respeita stop() ------------------

async function testReconnectAndStop() {
  let callCount = 0;
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, _command, _timeout, onData, _signal) {
      callCount++;
      if (callCount === 1) {
        // primeira "conexão": manda uma linha e cai (simula queda de SSH)
        onData?.('VELIX_SAMPLE cpu_total=100 cpu_idle=80 mem_total_kb=1000 mem_avail_kb=500 temp_c=40\n', false);
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const samples: RawSample[] = [];
  const watcher = new ServerWatcher(
    'srv-1',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    (sample) => samples.push(sample),
    () => {},
    async () => {}, // sleepFn sem espera real, pra não travar o teste
  );

  watcher.start();
  // dá tempo pro microtask do runLoop rodar algumas iterações
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();
  await new Promise((r) => setTimeout(r, 20));
  const countAfterStop = callCount;
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(samples.length >= 1, true, 'deveria ter recebido ao menos uma amostra');
  assert.equal(callCount, countAfterStop, 'não deveria reconectar depois de stop()');
  assert.equal(callCount >= 2, true, 'deveria ter tentado reconectar ao menos uma vez antes do stop');
}

// --- linha partida entre dois chunks é remontada antes de parsear ---------

async function testPartialLineBuffering() {
  // callCount evita reenviar a mesma linha em cada reconexão dentro da
  // janela de 20ms do teste (sem isso, samples.length passa de 1 pra várias
  // dezenas — mesmo padrão já usado em testReconnectAndStop acima).
  let callCount = 0;
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, _command, _timeout, onData) {
      callCount++;
      if (callCount === 1) {
        onData?.('VELIX_SAMPLE cpu_total=10', false);
        onData?.('0 cpu_idle=80 mem_total_kb=1000 mem_avail_kb=500 temp_c=40\n', false);
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const samples: RawSample[] = [];
  const watcher = new ServerWatcher(
    'srv-2',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    (sample) => samples.push(sample),
    () => {},
    async () => {},
  );

  watcher.start();
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();

  assert.equal(samples.length, 1);
  assert.equal(samples[0].cpuTotal, 100);
}

// --- eventos docker chegam pelo callback certo ------------------------------

async function testDockerEventCallback() {
  const fakeSsh: ServerWatcherSsh = {
    async runCommand(_options, command, _timeout, onData) {
      if (command.includes('docker events')) {
        onData?.(JSON.stringify({ Action: 'restart', Actor: { ID: 'c1', Attributes: { name: 'app' } } }) + '\n', false);
      }
      return { ok: true, code: 0, stdout: '', stderr: '' };
    },
  };

  const events: NormalizedDockerEvent[] = [];
  const watcher = new ServerWatcher(
    'srv-3',
    { host: 'x', port: 22, username: 'root' },
    fakeSsh,
    () => {},
    (event) => events.push(event),
    async () => {},
  );

  watcher.start();
  await new Promise((r) => setTimeout(r, 20));
  watcher.stop();

  assert.equal(events.length >= 1, true);
  assert.equal(events[0].kind, 'restarted');
}

async function main() {
  await testReconnectAndStop();
  await testPartialLineBuffering();
  await testDockerEventCallback();
  console.log('server-watcher self-check OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
