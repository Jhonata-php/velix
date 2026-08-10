import { randomBytes } from 'crypto';

/**
 * Ponte entre o upload HTTP de um .sql (`POST .../db-import/upload`, que
 * grava o arquivo em disco local via multer) e a importação de verdade
 * (canal /ops, que precisa só do caminho pra mandar por SFTP e streamar o
 * log). Mesmo padrão de `activeOps` em ops-server.ts: Map em memória do
 * processo, sem tabela nova — é estado transitório, não precisa sobreviver
 * a um restart da API.
 *
 * ponytail: sem faxina de uploads nunca consumidos (usuário escolhe o
 * arquivo e fecha a aba antes de confirmar a importação) — o arquivo fica
 * órfão em os.tmpdir() até o SO limpar. Aceitável pro volume de uso
 * esperado (um import manual de cada vez); revisitar se isso virar problema
 * de verdade.
 */
const uploads = new Map<string, string>();

export function registerSqlImportUpload(localPath: string): string {
  const id = randomBytes(16).toString('hex');
  uploads.set(id, localPath);
  return id;
}

export function consumeSqlImportUpload(id: string): string | undefined {
  const localPath = uploads.get(id);
  uploads.delete(id);
  return localPath;
}
