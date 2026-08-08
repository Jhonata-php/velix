/** Funções puras do terminal dentro de um container — sem I/O, testáveis
 * sem rede/SSH. Ver container-shell.util.spec.ts. */
import { shellSingleQuote } from '../database/mysql.util';

/**
 * Cliente de banco certo pra abrir dentro do container, a partir da imagem
 * declarada no manifesto — sem tentar logar sozinho (o usuário digita a
 * senha na hora, do jeito que já viu na aba Ambiente): detectar o cliente
 * certo já poupa o usuário de saber o nome do binário, e evitar login
 * automático evita guardar/derivar senha de bancos de terceiros que nem
 * sempre usam a mesma variável de ambiente entre manifestos.
 */
export function dbConsoleCommand(image: string): string | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'psql -U postgres';
  if (img.includes('mysql') || img.includes('mariadb')) return 'mysql -u root -p';
  if (img.includes('mongo')) return 'mongosh';
  if (img.includes('redis')) return 'redis-cli';
  return null;
}

/** Qual chave, dentro do `secretsEnc` da implantação, guarda a senha de root
 * — só os manifestos oficiais de Postgres/MySQL/MariaDB (`secrets: [{key:
 * ...}]` em cada um) têm esse nome garantido; Mongo/Redis ficam de fora
 * (formatos de dump diferentes, fora do escopo de "importar .sql"). */
export function dbImportSecretKey(image: string): string | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'POSTGRES_PASSWORD';
  if (img.includes('mysql') || img.includes('mariadb')) return 'ROOT_PASSWORD';
  return null;
}

/** Comando do cliente (já com senha e banco resolvidos) + flags extras de
 * `docker exec` que ele precisa (só Postgres: a senha vai por variável de
 * ambiente do processo, não por flag de linha de comando). Quem chama monta
 * o `docker exec` em volta e o `< arquivo` — aqui é só a parte específica do
 * motor de banco. */
export function dbImportCommand(image: string, password: string, dbName: string): { execFlags: string; command: string } | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) {
    return { execFlags: `-e PGPASSWORD=${shellSingleQuote(password)}`, command: `psql -U postgres -d ${shellSingleQuote(dbName)}` };
  }
  if (img.includes('mysql') || img.includes('mariadb')) {
    return { execFlags: '', command: `mysql -uroot -p${shellSingleQuote(password)} ${shellSingleQuote(dbName)}` };
  }
  return null;
}
