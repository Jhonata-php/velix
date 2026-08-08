/**
 * Self-check das funções puras do motor de implantação — sem framework:
 *   npx ts-node src/applications/applications.util.spec.ts
 */
import assert from 'node:assert';
import { slugify, appDir, allContainersUp, parseExposedPorts, isValidContainerRef, mergeComposeFragments, uniqueServiceName } from './applications.util';
import { renderCompose } from '../catalog/catalog.util';
import { uptimeKumaManifest } from '../catalog/manifests/uptime-kuma';
import { immichManifest } from '../catalog/manifests/immich';

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

// --- mergeComposeFragments ---------------------------------------------------
// Regressão do modelo de projeto: um projeto reúne composes de implantações
// diferentes (manifestos distintos, ou catálogo + Git) num único
// docker-compose.yml aplicado no servidor.

// vazio: sem implantação nenhuma, não escreve compose nenhum
assert.equal(mergeComposeFragments([]), '');
assert.equal(mergeComposeFragments(['', '  ']), '');

// uma implantação só: o merge devolve o mesmo conteúdo, só sem duplicar o
// bloco de rede (mesma implantação de sempre, sem nada pra juntar)
const kuma = renderCompose(uptimeKumaManifest, 'proj');
const mergedOne = mergeComposeFragments([kuma]);
assert.ok(mergedOne.includes('container_name: proj_app'));
assert.equal((mergedOne.match(/networks:\n {2}velix-proxy:/g) ?? []).length, 1);

// duas implantações diferentes no mesmo projeto: os serviços das duas
// aparecem, e o resultado ainda é um compose com UM services/UMA rede só
const immich = renderCompose(immichManifest, 'proj');
const merged = mergeComposeFragments([kuma, immich]);
assert.equal((merged.match(/^services:/gm) ?? []).length, 1, 'só um bloco services: no topo');
assert.ok(merged.includes('container_name: proj_app'), 'serviço do Uptime Kuma presente');
assert.ok(merged.includes(`image: ${immichManifest.services[0].image}`), 'serviço do Immich presente');
assert.equal((merged.match(/networks:\n {2}velix-proxy:\n {4}external: true/g) ?? []).length, 1, 'uma rede só no fim');

// volume com o mesmo nome em duas implantações vira uma linha só (mesmo
// comportamento de dedup que já existia dentro de um único manifesto)
const merged2x = mergeComposeFragments([kuma, kuma]);
const volumeLines = (merged2x.match(/^ {2}proj_[a-z0-9_]+:$/gm) ?? []).length;
assert.equal(volumeLines, 1, 'volume repetido entre implantações não duplica');

console.log('mergeComposeFragments self-check OK');

// --- uniqueServiceName -------------------------------------------------------
// Dois repositórios Git no mesmo projeto não podem virar os dois "app".
assert.equal(uniqueServiceName('my-backend', []), 'my-backend');
assert.equal(uniqueServiceName('My Backend!', []), 'my-backend');
assert.equal(uniqueServiceName('app', ['app']), 'app-2');
assert.equal(uniqueServiceName('app', ['app', 'app-2']), 'app-3');

console.log('uniqueServiceName self-check OK');
