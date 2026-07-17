export interface DockerContainer {
  id: string;
  image: string;
  status: string;
  names: string;
}

// ponytail: agrupa containers do mesmo app do EasyPanel (ex.: apps_immich,
// apps_immich-ml, apps_immich-redis, apps_immich-db) sob uma raiz comum —
// acha o nome-base mais curto que é prefixo dos outros (separado por "-"),
// sem depender de nenhuma convenção documentada do EasyPanel.
export function stripSwarmSuffix(name: string) {
  // O sufixo de task do Swarm é ".<réplica>.<hash>" e o hash pode conter hífen
  // (ex.: "...djnfde7xm21-clone") — por isso o char class inclui "-".
  return name.replace(/\.\d+\.[a-z0-9-]+$/i, '');
}

export function groupContainers(containers: DockerContainer[]) {
  const bases = containers.map((c) => ({ container: c, base: stripSwarmSuffix(c.names) }));
  const uniqueBases = Array.from(new Set(bases.map((b) => b.base))).sort((a, b) => a.length - b.length);
  const rootOf = new Map<string, string>();
  for (const base of uniqueBases) {
    let root = base;
    for (const candidate of uniqueBases) {
      if (candidate.length < base.length && base.startsWith(`${candidate}-`)) {
        root = rootOf.get(candidate) ?? candidate;
        break;
      }
    }
    rootOf.set(base, root);
  }

  const groups = new Map<string, DockerContainer[]>();
  for (const { container, base } of bases) {
    const key = rootOf.get(base) ?? base;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(container);
  }
  return Array.from(groups.entries()).map(([key, members]) => ({ key, containers: members }));
}

/** Nome curto do serviço dentro do projeto — tira a raiz do grupo e o hífen, ex.: "apps_immich-db" com raiz "apps_immich" -> "db". */
export function serviceLabel(containerName: string, groupKey: string) {
  const base = stripSwarmSuffix(containerName);
  if (base === groupKey) return base;
  if (base.startsWith(`${groupKey}-`)) return base.slice(groupKey.length + 1);
  return base;
}

const AVATAR_COLORS = [
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  'bg-teal-500/15 text-teal-600 dark:text-teal-400',
];

/** Cor determinística (hash do nome) pra dar identidade visual a cada serviço/projeto, tipo avatar de app. */
export function avatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
