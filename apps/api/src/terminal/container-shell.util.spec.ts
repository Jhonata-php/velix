/**
 * Self-check das funções puras do terminal de container — sem framework:
 *   npx ts-node src/terminal/container-shell.util.spec.ts
 */
import assert from 'node:assert';
import { dbConsoleCommand } from './container-shell.util';

assert.equal(dbConsoleCommand('postgres:16-alpine'), 'psql -U postgres');
assert.equal(dbConsoleCommand('mysql:8'), 'mysql -u root -p');
assert.equal(dbConsoleCommand('mariadb:11'), 'mysql -u root -p');
assert.equal(dbConsoleCommand('mongo:7'), 'mongosh');
assert.equal(dbConsoleCommand('redis:7-alpine'), 'redis-cli');
// case-insensitive — tags de imagem variam maiúscula/minúscula na prática
assert.equal(dbConsoleCommand('POSTGRES:16'), 'psql -U postgres');
// não-banco: sem console
assert.equal(dbConsoleCommand('nginx:alpine'), null);
assert.equal(dbConsoleCommand('henrygd/beszel:0.14.0'), null);

console.log('container-shell.util self-check OK');
