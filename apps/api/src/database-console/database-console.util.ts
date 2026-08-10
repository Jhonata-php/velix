/** Funções puras do console de banco embutido — sem I/O, testáveis sem
 * rede/SSH/driver. Ver database-console.util.spec.ts. */

export type DbEngine = 'postgresql' | 'mysql' | 'mariadb';

/** Mesma detecção de imagem já usada em `dbImportSecretKey`/`dbConsoleCommand`
 * (container-shell.util.ts) — reaproveitada aqui como tipo literal em vez de
 * string solta, porque o resto deste módulo decide SQL/porta/usuário a partir
 * disto. */
export function resolveEngine(image: string): DbEngine | null {
  const img = image.toLowerCase();
  if (img.includes('postgres')) return 'postgresql';
  if (img.includes('mariadb')) return 'mariadb';
  if (img.includes('mysql')) return 'mysql';
  return null;
}

export function enginePort(engine: DbEngine): number {
  return engine === 'postgresql' ? 5432 : 3306;
}

/** Sempre o superusuário criado pela imagem oficial — sem tela de login,
 * autentica sozinho com a senha root já gerada no deploy. */
export function engineUser(engine: DbEngine): string {
  return engine === 'postgresql' ? 'postgres' : 'root';
}

/** Nome de tabela só é seguro de interpolar num identificador SQL depois de
 * bater com a lista real de tabelas do banco (`information_schema`/`pg_class`)
 * — nunca confiado direto do parâmetro da URL. Mesma lição de injeção que já
 * pegou um bug real na v1.15.2 (dbImportCommand). */
export function isKnownTable(table: string, known: string[]): boolean {
  return known.includes(table);
}

/** Página/tamanho de página seguros — página inválida cai pra 1, tamanho
 * inválido ou acima do teto (200) cai pro padrão (50), pra nunca deixar
 * `LIMIT`/`OFFSET` receber algo fora do esperado. */
export function paginate(page: number, pageSize: number): { limit: number; offset: number } {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = Number.isInteger(pageSize) && pageSize > 0 && pageSize <= 200 ? pageSize : 50;
  return { limit: safeSize, offset: (safePage - 1) * safeSize };
}
