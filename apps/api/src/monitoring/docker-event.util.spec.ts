/**
 * Self-check do classificador de eventos Docker — sem framework:
 *   npx ts-node src/monitoring/docker-event.util.spec.ts
 */
import assert from 'node:assert';
import { parseDockerEventLine } from './docker-event.util';

// container parou de propósito (docker stop / exit 0)
const stopped = parseDockerEventLine(
  JSON.stringify({
    Action: 'die',
    Actor: { ID: 'abc123', Attributes: { name: 'meuapp_web', exitCode: '0' } },
  }),
);
assert.deepEqual(stopped, { kind: 'stopped', containerId: 'abc123', containerName: 'meuapp_web', exitCode: 0 });

// container travou (exit code != 0)
const crashed = parseDockerEventLine(
  JSON.stringify({
    Action: 'die',
    Actor: { ID: 'def456', Attributes: { name: 'meuapp_worker', exitCode: '137' } },
  }),
);
assert.deepEqual(crashed, { kind: 'crashed', containerId: 'def456', containerName: 'meuapp_worker', exitCode: 137 });

// reinício explícito (docker restart / política de restart)
const restarted = parseDockerEventLine(
  JSON.stringify({ Action: 'restart', Actor: { ID: 'ghi789', Attributes: { name: 'meuapp_db' } } }),
);
assert.deepEqual(restarted, { kind: 'restarted', containerId: 'ghi789', containerName: 'meuapp_db', exitCode: null });

// ação irrelevante (create, start isolado, destroy, etc.) — ignorada
assert.equal(
  parseDockerEventLine(JSON.stringify({ Action: 'create', Actor: { ID: 'x', Attributes: {} } })),
  null,
);

// sem nome do container — cai pro id
const noName = parseDockerEventLine(
  JSON.stringify({ Action: 'die', Actor: { ID: 'noname1', Attributes: { exitCode: '0' } } }),
);
assert.equal(noName!.containerName, 'noname1');

// linha malformada / vazia
assert.equal(parseDockerEventLine('não é json'), null);
assert.equal(parseDockerEventLine(''), null);
assert.equal(parseDockerEventLine('   '), null);

console.log('docker-event.util self-check OK');
