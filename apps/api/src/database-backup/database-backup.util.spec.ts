/**
 * Self-check das funções puras de backup de banco — sem framework:
 *   npx ts-node src/database-backup/database-backup.util.spec.ts
 */
import assert from 'node:assert';
import { dumpCommand, dumpPipelineCommand, isManagedDatabaseImage, backupFileName, moveToBackupDirCommand, pruneBackupsCommand } from './database-backup.util';
import { shellSingleQuote } from '../database/mysql.util';

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

// --- dumpPipelineCommand ----------------------------------------------------
const remoteTmp = '/tmp/velix-backup-abc.sql.gz';
const pipeline = dumpPipelineCommand(pg!.execFlags, "db'container", pg!.command, remoteTmp);
assert.ok(pipeline.startsWith('bash -c '), 'pipeline inteiro tem que rodar sob bash -c pra garantir suporte a pipefail (login shell pode ser dash/sh)');
// o pipeline inteiro é o argumento único de `bash -c`, então as substrings originais
// só aparecem depois de re-escapadas pela camada externa — reconstrói o esperado
// com o mesmo shellSingleQuote que a função usa, em vez de decodificar a string.
const expectedInner = `set -o pipefail; umask 077; sudo docker exec ${pg!.execFlags} ${shellSingleQuote("db'container")} ${pg!.command} | gzip > ${remoteTmp} && chmod 600 ${remoteTmp}`;
assert.equal(pipeline, `bash -c ${shellSingleQuote(expectedInner)}`);
assert.ok(expectedInner.includes('set -o pipefail'), 'sem pipefail o gzip mascara falha do dump (bug corrigido)');
assert.ok(expectedInner.includes('umask 077'), 'sem umask o dump fica world-readable até o chmod final');
assert.ok(expectedInner.endsWith(`&& chmod 600 ${remoteTmp}`), 'tem que terminar travando a permissão do arquivo');

function shellSingleQuoteExpected(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// --- moveToBackupDirCommand -------------------------------------------------
const moveCmd = moveToBackupDirCommand('/opt/velix/apps/my-app/backups', remoteTmp, 'db-2026-01-01T00-00-00-000Z-abc123.sql.gz');
assert.equal(
  moveCmd,
  "sudo mkdir -p '/opt/velix/apps/my-app/backups' && sudo mv '/tmp/velix-backup-abc.sql.gz' '/opt/velix/apps/my-app/backups/db-2026-01-01T00-00-00-000Z-abc123.sql.gz'",
);

// fileName vem de backupFileName(service.name) — service.name é String sem
// formato garantido, então tem que ir escapado como qualquer outro valor
const maliciousFileName = "app'; rm -rf / #.sql.gz";
const moveInjected = moveToBackupDirCommand('/opt/velix/apps/my-app/backups', remoteTmp, maliciousFileName);
assert.ok(
  moveInjected.includes(shellSingleQuoteExpected(`/opt/velix/apps/my-app/backups/${maliciousFileName}`)),
  'fileName malicioso tem que ir escapado com aspa simples dentro do mv',
);
assert.ok(!/rm -rf \/ #\.sql\.gz'/.test(moveInjected.replace(shellSingleQuoteExpected(`/opt/velix/apps/my-app/backups/${maliciousFileName}`), '')), 'sem sobra do payload fora da aspa escapada');

// --- pruneBackupsCommand -----------------------------------------------------
const pruneCmd = pruneBackupsCommand('/opt/velix/apps/my-app/backups', 'db', 14);
assert.equal(pruneCmd, "sudo find '/opt/velix/apps/my-app/backups' -name 'db-*.sql.gz' -mtime +14 -delete");
assert.ok(pruneCmd.startsWith('sudo '), 'sudo é obrigatório — a pasta é criada root:root por moveToBackupDirCommand');
assert.ok(pruneCmd.includes("-name 'db-*.sql.gz'"), 'o glob tem que ser restrito ao prefixo deste serviço, não *.sql.gz geral (senão poda backup de outro banco no mesmo projeto)');

// nome de serviço malicioso não pode escapar da aspa simples
const maliciousServiceName = "app'; rm -rf / #";
const pruneInjected = pruneBackupsCommand('/opt/velix/apps/my-app/backups', maliciousServiceName, 365);
assert.equal(
  pruneInjected,
  "sudo find '/opt/velix/apps/my-app/backups' -name 'app'\\''; rm -rf / #-*.sql.gz' -mtime +365 -delete",
);

// --- backupFileName --------------------------------------------------------
const name1 = backupFileName('db');
assert.ok(/^db-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{6}\.sql\.gz$/.test(name1), `formato inesperado: ${name1}`);
// dois nomes gerados em sequência não colidem no mesmo milissegundo (timestamp + sufixo aleatório garante unicidade)
assert.notEqual(backupFileName('db'), backupFileName('db'));

console.log('database-backup.util self-check OK');
