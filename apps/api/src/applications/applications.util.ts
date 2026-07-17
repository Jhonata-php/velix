/** Funções puras do motor de implantação — sem I/O, testáveis sem servidor.
 * Ver applications.util.spec.ts (`npx ts-node src/applications/applications.util.spec.ts`). */

export const APPS_ROOT = '/opt/velix/apps';

const COMBINING_DIACRITICS = /[\u0300-\u036f]/g;

/** Nome de diretório/projeto Docker Compose a partir do nome dado pelo usuário. */
export function slugify(text: string): string {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'app';
}

export function appDir(slug: string): string {
  return `${APPS_ROOT}/${slug}`;
}

/** Todos os containers esperados aparecem "Up" na saída de
 * `docker ps --format '{{.Names}}|{{.Status}}'`? */
export function allContainersUp(psOutput: string, expectedNames: string[]): boolean {
  const statusByName = new Map(
    psOutput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...rest] = line.split('|');
        return [name, rest.join('|')] as const;
      }),
  );
  return expectedNames.every((name) => (statusByName.get(name) ?? '').toLowerCase().includes('up'));
}

/** Parseia `docker inspect <container> --format '{{json .Config.ExposedPorts}}'`
 * (ex.: `{"3001/tcp":{}}`, ou `null` quando a imagem não declara nenhuma porta) —
 * fallback quando o manifesto não lista as portas do serviço. */
export function parseExposedPorts(dockerInspectOutput: string): { port: number; protocol: string }[] {
  try {
    const parsed = JSON.parse(dockerInspectOutput.trim());
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.keys(parsed)
      .map((key) => {
        const [port, protocol] = key.split('/');
        return { port: Number(port), protocol: protocol || 'tcp' };
      })
      .filter((p) => Number.isFinite(p.port));
  } catch {
    return [];
  }
}
