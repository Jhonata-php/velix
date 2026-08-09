/**
 * Self-check das funções puras de backup de banco — sem framework:
 *   npx ts-node src/database-backup/database-backup.util.spec.ts
 */
import assert from 'node:assert';
import { dumpCommand, isManagedDatabaseImage, backupFileName } from './database-backup.util';

// --- isManagedDatabaseImage ---------------------------------------------------
assert.equal(isManagedDatabaseImage('postgres:16.4'), true);
assert.equal(isManagedDatabaseImage('mysql:8.4'), true);
assert.equal(isManagedDatabaseImage('mariadb:11.4'), true);
assert.equal(isManagedDatabaseImage('POSTGRES:16'), true, 'case-insensitive');
assert.equal(isManagedDatabaseImage('mongo:7'), false, 'mongo fora do escopo de backup');
assert.equal(isManagedDatabaseImage('redis:7-alpine'), false);
assert.equal(isManagedDatabaseImage('nginx:alpine'), false);

// --- dumpCommand ---------------------------------------------------------------
const pg = dumpCommand('postgres:16.4', "senha'com'aspas", 'app');
assert.ok(pg);
assert.equal(pg!.command, "pg_dump -U postgres -d 'app' --no-owner --no-privileges");
assert.ok(pg!.execFlags.startsWith('-e PGPASSWORD='), 'postgres passa a senha por variável de ambiente do exec');
assert.ok(!/PGPASSWORD=senha'com/.test(pg!.execFlags), 'senha com aspa simples não pode quebrar o comando');

const mysql = dumpCommand('mysql:8.4', 'segredo', 'app');
assert.ok(mysql);
assert.equal(mysql!.execFlags, '');
assert.equal(mysql!.command, "mysqldump -uroot -p'segredo' 'app'");

const mariadb = dumpCommand('mariadb:11.4', 'segredo', 'app');
assert.ok(mariadb);
assert.equal(mariadb!.command, "mysqldump -uroot -p'segredo' 'app'");

assert.equal(dumpCommand('mongo:7', 'x', 'app'), null);
assert.equal(dumpCommand('nginx:alpine', 'x', 'app'), null);

// nome de banco malicioso não pode escapar da aspa simples — mesma lição da
// injeção real encontrada em dbImportCommand (v1.15.2)
const injected = dumpCommand('postgres:16', 'pw', "app'; rm -rf / #");
assert.ok(injected);
assert.equal(injected!.command, "pg_dump -U postgres -d 'app'\\''; rm -rf / #' --no-owner --no-privileges");

// --- backupFileName --------------------------------------------------------
const name1 = backupFileName('db');
assert.ok(/^db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}\.sql\.gz$/.test(name1), `formato inesperado: ${name1}`);
// dois nomes gerados em sequência não colidem no mesmo milissegundo (timestamp + sufixo aleatório garante unicidade)
assert.notEqual(backupFileName('db'), backupFileName('db'));

console.log('database-backup.util self-check OK');
