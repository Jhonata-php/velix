/**
 * Self-check das funções puras do console de banco — sem framework:
 *   npx ts-node src/database-console/database-console.util.spec.ts
 */
import assert from 'node:assert';
import { resolveEngine, enginePort, engineUser, isKnownTable, paginate } from './database-console.util';

// --- resolveEngine ---------------------------------------------------------
assert.equal(resolveEngine('postgres:16.4'), 'postgresql');
assert.equal(resolveEngine('POSTGRES:16'), 'postgresql', 'case-insensitive');
assert.equal(resolveEngine('mariadb:11.4'), 'mariadb');
assert.equal(resolveEngine('mysql:8.4'), 'mysql');
assert.equal(resolveEngine('mongo:7'), null);
assert.equal(resolveEngine('nginx:alpine'), null);

// --- enginePort / engineUser ------------------------------------------------
assert.equal(enginePort('postgresql'), 5432);
assert.equal(enginePort('mysql'), 3306);
assert.equal(enginePort('mariadb'), 3306);
assert.equal(engineUser('postgresql'), 'postgres');
assert.equal(engineUser('mysql'), 'root');
assert.equal(engineUser('mariadb'), 'root');

// --- isKnownTable ------------------------------------------------------------
assert.equal(isKnownTable('users', ['users', 'posts']), true);
assert.equal(
  isKnownTable('users; DROP TABLE posts', ['users', 'posts']),
  false,
  'nome fora da lista real não passa, mesmo parecendo SQL válido',
);
assert.equal(isKnownTable('users', []), false);

// --- paginate ------------------------------------------------------------------
assert.deepEqual(paginate(1, 50), { limit: 50, offset: 0 });
assert.deepEqual(paginate(3, 20), { limit: 20, offset: 40 });
assert.deepEqual(paginate(0, 50), { limit: 50, offset: 0 }, 'página inválida cai pro padrão');
assert.deepEqual(paginate(1, 9999), { limit: 50, offset: 0 }, 'pageSize acima do teto cai pro padrão');
assert.deepEqual(paginate(-1, -1), { limit: 50, offset: 0 });

console.log('database-console.util self-check OK');
