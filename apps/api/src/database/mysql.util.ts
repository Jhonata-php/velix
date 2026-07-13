import { randomBytes } from 'crypto';

export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

/** Coloca uma string entre aspas simples segura para uso em comando de shell (via SSH exec). */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Parseia a saída de `mysql -e "SHOW REPLICA STATUS\G"` (formato "Campo: valor" por linha). */
export function parseReplicaStatus(output: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (key) result[key] = line.slice(idx + 1).trim();
  }
  return result;
}
