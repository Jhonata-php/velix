/** Funções puras do backup de banco de dados — sem I/O, testáveis sem
 * servidor. Ver database-backup.util.spec.ts. Irmã de
 * `terminal/container-shell.util.ts` (que cobre import, não export). */
import { randomBytes } from 'crypto';
import { shellSingleQuote } from '../database/mysql.util';

const MANAGED_ENGINES = ['postgres', 'mysql', 'mariadb'];

/** Mesmo escopo de `dbImportSecretKey`/`supportsSqlImport` — só bancos com
 * dump/restauração via `.sql` e senha em local previsível. */
export function isManagedDatabaseImage(image: string): boolean {
  const img = image.toLowerCase();
  return MANAGED_ENGINES.some((needle) => img.includes(needle));
}

/**
 * Comando do dump (sem o `docker exec` em volta, sem o redirecionamento pro
 * arquivo — isso é montado por quem chama, mesmo padrão de `dbImportCommand`).
 * `dbName` é uma variável de deploy digitada pelo usuário — protegida com
 * `shellSingleQuote` como qualquer outro valor que entra num comando remoto.
 */
export function dumpCommand(image: string, password: string, dbName: string): { execFlags: string; command: string } | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) {
    return {
      execFlags: `-e PGPASSWORD=${shellSingleQuote(password)}`,
      command: `pg_dump -U postgres -d ${shellSingleQuote(dbName)} --no-owner --no-privileges`,
    };
  }
  if (img.includes('mysql') || img.includes('mariadb')) {
    return { execFlags: '', command: `mysqldump -uroot -p${shellSingleQuote(password)} ${shellSingleQuote(dbName)}` };
  }
  return null;
}

/** Nome de arquivo com timestamp completo (não só data) — dois backups do
 * mesmo banco no mesmo dia não podem colidir. Adiciona sufixo aleatório
 * para garantir unicidade mesmo em chamadas síncronas no mesmo milissegundo. */
export function backupFileName(serviceName: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomBytes(3).toString('hex');
  return `${serviceName}-${stamp}-${suffix}.sql.gz`;
}

/**
 * Monta o comando completo executado por SSH pra gerar o dump: `docker exec`
 * pipado pro `gzip`, gravado no tmp remoto e travado com `chmod 600`.
 * `set -o pipefail` é essencial — sem ele, se o `pg_dump`/`mysqldump` falhar
 * (senha errada, container fora do ar, disco cheio) o `gzip` mesmo assim sai
 * com status 0 (só recebeu stdin vazio), e o backup corrompido é gravado
 * como SUCCESS. `umask 077` garante que o arquivo já nasce 0600, em vez de
 * ficar world-readable no /tmp durante toda a janela do dump até o `chmod`
 * rodar no final.
 */
export function dumpPipelineCommand(execFlags: string, containerName: string, command: string, remoteTmp: string): string {
  return `set -o pipefail; umask 077; sudo docker exec ${execFlags} ${shellSingleQuote(containerName)} ${command} | gzip > ${remoteTmp} && chmod 600 ${remoteTmp}`;
}
