/**
 * Self-check das funções puras do motor de implantação — sem framework:
 *   npx ts-node src/applications/applications.util.spec.ts
 */
import assert from 'node:assert';
import { slugify, appDir, allContainersUp, parseExposedPorts, isValidContainerRef } from './applications.util';

assert.equal(slugify('Meu App Legal!'), 'meu-app-legal');
assert.equal(slugify('   '), 'app');
assert.equal(slugify('Ação Ção'), 'acao-cao');
assert.equal(appDir('minha-app'), '/opt/velix/apps/minha-app');

const ps = 'meuapp_app|Up 3 minutes\nmeuapp_db|Exited (0) 2 minutes ago';
assert.equal(allContainersUp(ps, ['meuapp_app']), true);
assert.equal(allContainersUp(ps, ['meuapp_app', 'meuapp_db']), false);
assert.equal(allContainersUp('', ['meuapp_app']), false);

assert.deepEqual(parseExposedPorts('{"3001/tcp":{}}'), [{ port: 3001, protocol: 'tcp' }]);
assert.deepEqual(parseExposedPorts('{"9000/tcp":{},"9001/tcp":{}}'), [
  { port: 9000, protocol: 'tcp' },
  { port: 9001, protocol: 'tcp' },
]);
assert.deepEqual(parseExposedPorts('null'), []);
assert.deepEqual(parseExposedPorts(''), []);
assert.deepEqual(parseExposedPorts('não é json'), []);

console.log('applications.util self-check OK');

// --- identificador de container ---------------------------------------------
// Regressão: este valor vem da URL e entra num comando shell executado como
// root no servidor gerenciado.
assert.equal(isValidContainerRef('velix-traefik'), true);
assert.equal(isValidContainerRef('a1b2c3d4e5f6'), true);
assert.equal(isValidContainerRef('meuapp_app'), true);
assert.equal(isValidContainerRef('app.v2'), true);

assert.equal(isValidContainerRef('abc; id > /tmp/owned'), false);
assert.equal(isValidContainerRef('abc$(whoami)'), false);
assert.equal(isValidContainerRef('abc`whoami`'), false);
assert.equal(isValidContainerRef('abc|sh'), false);
assert.equal(isValidContainerRef('abc && rm -rf /'), false);
assert.equal(isValidContainerRef('--rm'), false);
assert.equal(isValidContainerRef(''), false);
assert.equal(isValidContainerRef('a'.repeat(200)), false);

console.log('container ref self-check OK');
