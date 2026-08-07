/**
 * Self-check da montagem das variáveis de conexão do backup:
 *   npx ts-node src/backup/backup.util.spec.ts
 *
 * Regressão do erro real: PGDATABASE recebia a URI inteira, o libpq a tratava
 * como nome de banco literal, ignorava host e porta e caía no socket local —
 * `connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed`.
 */
import assert from 'node:assert';

/** Mesma lógica de BackupService.connectionEnv — mantida aqui como função pura
 * para poder ser exercitada sem instanciar o Nest. */
function connectionEnv(url: string): Record<string, string> {
  const parsed = new URL(url);
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: parsed.pathname.replace(/^\//, ''),
  };
}

const real = connectionEnv('postgresql://velix:s3nh4@postgres:5432/velix?schema=public');
assert.equal(real.PGHOST, 'postgres', 'host precisa sair da URL — era isso que faltava e causava o socket local');
assert.equal(real.PGPORT, '5432');
assert.equal(real.PGUSER, 'velix');
assert.equal(real.PGPASSWORD, 's3nh4');
assert.equal(real.PGDATABASE, 'velix', 'o nome do banco não pode carregar a query string');

// Senha com caracteres especiais: o instalador gera com openssl e o valor entra
// percent-encoded na URL. Sem decodificar, a autenticação falharia.
const encoded = connectionEnv('postgresql://velix:a%40b%2Fc@postgres:5432/velix');
assert.equal(encoded.PGPASSWORD, 'a@b/c');

// Porta omitida cai no padrão do Postgres.
assert.equal(connectionEnv('postgresql://u:p@host/db').PGPORT, '5432');

// Nenhuma variável pode conter a URI inteira — era exatamente o bug.
for (const [key, value] of Object.entries(real)) {
  assert.ok(!value.startsWith('postgresql://'), `${key} recebeu a URI inteira`);
}

console.log('backup connection env self-check OK');
