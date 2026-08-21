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

/** Nome de serviço único dentro de um projeto (ex.: derivado do nome do
 * repositório Git) — dois repositórios implantados no mesmo projeto não podem
 * virar os dois "app". Mesmo padrão de desambiguação de `uniqueSlug`. */
export function uniqueServiceName(base: string, existingNames: string[]): string {
  const clean = slugify(base);
  if (!existingNames.includes(clean)) return clean;
  for (let i = 2; i < 100; i++) {
    const candidate = `${clean}-${i}`;
    if (!existingNames.includes(candidate)) return candidate;
  }
  return `${clean}-${Date.now()}`;
}

/** `docker ps --format '{{.Names}}|{{.Status}}'` → nome do container → texto
 * bruto do status (ex.: "Up 3 hours", "Exited (0) 2 days ago"). */
export function parseContainerStatuses(psOutput: string): Map<string, string> {
  return new Map(
    psOutput
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, ...rest] = line.split('|');
        return [name, rest.join('|')] as const;
      }),
  );
}

/** Nomes de container na saída de `docker ps` que começam com `${slug}_` —
 * fallback pra quando não há lista guardada de containers do projeto
 * (`Application.containerNames`/`ProjectService`, ambos adicionados depois
 * que alguns projetos já existiam, sem backfill retroativo). Todo container
 * do Velix segue esse padrão de nome (`renderCompose`/`GitDeployService`
 * sempre montam `${slug}_${serviceName}`), então o prefixo sozinho já basta
 * pra achar os containers de um projeto sem precisar de nenhum dado extra. */
export function containersByPrefix(psOutput: string, slug: string): string[] {
  const prefix = `${slug}_`;
  return [...parseContainerStatuses(psOutput).keys()].filter((name) => name.startsWith(prefix));
}

/** Todos os containers esperados aparecem "Up" na saída de
 * `docker ps --format '{{.Names}}|{{.Status}}'`? */
export function allContainersUp(psOutput: string, expectedNames: string[]): boolean {
  const statusByName = parseContainerStatuses(psOutput);
  return expectedNames.every((name) => (statusByName.get(name) ?? '').toLowerCase().includes('up'));
}

/** Status agregado de um projeto a partir do status real (docker ps) de cada
 * um dos seus serviços — usado pra corrigir `Application.status`/
 * `ProjectService.status` quando ficam desatualizados em relação ao Docker de
 * verdade (ex.: a API reiniciou no meio de um evento, ou o container caiu e
 * subiu de novo por conta própria, sem passar pelas ações do Velix). Todos
 * rodando → RUNNING; nenhum rodando → STOPPED; misto → ERROR (estado que
 * merece atenção, não é nem "no ar" nem "totalmente parado"). */
export function aggregateContainerStatus(containerNames: string[], psOutput: string): 'RUNNING' | 'STOPPED' | 'ERROR' {
  const statusByName = parseContainerStatuses(psOutput);
  const upCount = containerNames.filter((name) => (statusByName.get(name) ?? '').toLowerCase().includes('up')).length;
  if (upCount === containerNames.length) return 'RUNNING';
  if (upCount === 0) return 'STOPPED';
  return 'ERROR';
}

const DOCKER_SIZE_UNIT_TO_MB: Record<string, number> = { b: 1 / 1024 / 1024, kib: 1 / 1024, mib: 1, gib: 1024, tib: 1024 * 1024 };

/** "165.1MiB" → 165.1 (em MB). Unidade de `docker stats --format '{{.MemUsage}}'`. */
function parseDockerSizeMb(text: string): number | null {
  const m = text.trim().match(/^([\d.]+)\s*([a-zA-Z]+)$/);
  if (!m) return null;
  const mult = DOCKER_SIZE_UNIT_TO_MB[m[2].toLowerCase()];
  if (mult === undefined) return null;
  return Number(m[1]) * mult;
}

/** "165.1MiB / 11.65GiB" → memória usada/total em MB — formato de
 * `docker stats --format '{{.MemUsage}}'`. */
export function parseMemUsage(memUsage: string | null | undefined): { usedMb: number | null; totalMb: number | null } {
  if (!memUsage) return { usedMb: null, totalMb: null };
  const [usedRaw, totalRaw] = memUsage.split('/').map((s) => s.trim());
  return {
    usedMb: usedRaw ? parseDockerSizeMb(usedRaw) : null,
    totalMb: totalRaw ? parseDockerSizeMb(totalRaw) : null,
  };
}

/** "4.47%" → 4.47 — formato de `docker stats --format '{{.CPUPerc}}'`. */
export function parseCpuPercent(cpuPerc: string | null | undefined): number | null {
  if (!cpuPerc) return null;
  const n = Number(cpuPerc.replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
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

/**
 * Identificador de container vindo da URL, antes de entrar num comando shell.
 *
 * `containerId` chega como parâmetro de rota e era interpolado direto em
 * `sudo docker <ação> ${containerId}` executado por SSH como root. Um valor
 * como `abc%3B%20curl...` decodifica para `abc; curl...` e o `;` encerra o
 * comando — execução arbitrária como root no servidor gerenciado, por qualquer
 * usuário autenticado do painel.
 *
 * O Docker aceita nome (letras, números, `_`, `.`, `-`) ou hash hexadecimal, e
 * nada mais. Recusar o resto é mais simples e mais seguro que tentar escapar.
 */
export function isValidContainerRef(value: string): boolean {
  if (!value || value.length > 128) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value);
}

interface ComposeFragment {
  servicesPart: string;
  volumeLines: string[];
}

/** `renderCompose`/`renderGitCompose` sempre produzem o mesmo formato
 * determinístico (`services:\n<blocos>\n\n[volumes:\n<linhas>\n\n]networks:\n
 * velix-proxy:\n external: true\n`) — extrai as partes sem precisar de um
 * parser de YAML de verdade. */
// Só remove linhas em branco nas pontas — nunca espaços, porque a indentação
// da primeira linha (`  nome-do-serviço:`) faz parte do YAML.
function trimBlankLines(text: string): string {
  return text.replace(/^\n+/, '').replace(/\s+$/, '');
}

function parseComposeFragment(compose: string): ComposeFragment {
  const body = compose.replace(/^services:\n/, '');
  const volumesIdx = body.indexOf('\nvolumes:\n');
  if (volumesIdx === -1) {
    const networksIdx = body.indexOf('\nnetworks:\n');
    const servicesPart = trimBlankLines(networksIdx === -1 ? body : body.slice(0, networksIdx));
    return { servicesPart, volumeLines: [] };
  }
  const servicesPart = trimBlankLines(body.slice(0, volumesIdx));
  const afterVolumes = body.slice(volumesIdx + '\nvolumes:\n'.length);
  const volumesEndIdx = afterVolumes.indexOf('\nnetworks:\n');
  const volumesBody = volumesEndIdx === -1 ? afterVolumes : afterVolumes.slice(0, volumesEndIdx);
  const volumeLines = volumesBody
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
  return { servicesPart, volumeLines };
}

/**
 * Um projeto pode reunir serviços de implantações diferentes (manifestos do
 * catálogo distintos, ou catálogo + Git) — mas o servidor só entende UM
 * `docker-compose.yml` por projeto (`docker compose -p <slug> up -d`). Junta
 * os composes já renderizados de cada implantação num compose só: um
 * `services:` com os blocos de todas, um `volumes:` deduplicado (dois
 * manifestos usando por acaso o mesmo nome de volume geram uma linha só,
 * igual ao comportamento já existente dentro de um manifesto), e um único
 * `networks: velix-proxy: external: true` no fim.
 */
export function mergeComposeFragments(composes: string[]): string {
  const fragments = composes.filter((c) => c.trim().length > 0).map(parseComposeFragment);
  if (fragments.length === 0) return '';

  const servicesBlock = fragments.map((f) => f.servicesPart).join('\n\n');
  const volumeNames = Array.from(new Set(fragments.flatMap((f) => f.volumeLines)));
  const volumesBlock = volumeNames.length > 0 ? `\nvolumes:\n${volumeNames.join('\n')}\n` : '';

  return `services:\n${servicesBlock}\n${volumesBlock}\nnetworks:\n  velix-proxy:\n    external: true\n`;
}
