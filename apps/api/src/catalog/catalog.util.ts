/**
 * Formato nativo do Velix pra descrever uma aplicação implantável — todo
 * template, seja do catálogo oficial (hoje) ou de uma fonte externa (quando
 * existir), é convertido pra isso antes de qualquer implantação. Funções
 * puras (sem I/O) pra serem testáveis sem servidor — ver catalog.util.spec.ts.
 * A única exceção impura é `generateSecretValue` (usa random real).
 */

import { randomBytes } from 'crypto';

export interface VelixManifestVolume {
  /** Nome lógico do volume — vira `${appSlug}_${name}` no compose renderizado. */
  name: string;
  containerPath: string;
}

export interface VelixManifestPort {
  port: number;
  protocol?: 'tcp' | 'udp';
  /** Porta sugerida por padrão quando o usuário associa um domínio a este serviço. */
  recommended?: boolean;
}

export interface VelixManifestVariable {
  /** Referenciada como `{{var:CHAVE}}` no `environment` de qualquer serviço do manifesto. */
  key: string;
  label: string;
  description?: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  options?: string[];
  default?: string;
  required?: boolean;
}

export interface VelixManifestService {
  /** Nome do serviço dentro do compose (ex.: "app"). */
  name: string;
  image: string;
  /** Valores podem referenciar `{{secret:CHAVE}}` (ver `secrets` do manifesto),
   * `{{service:NOME}}` (nome de container de outro serviço do mesmo app) e
   * `{{var:CHAVE}}` (ver `variables` do serviço). */
  environment?: Record<string, string>;
  /** Valores configuráveis pelo usuário no assistente de implantação. */
  variables?: VelixManifestVariable[];
  volumes?: VelixManifestVolume[];
  command?: string;
  /** Portas internas do container — usadas pelo assistente de domínio pra sugerir a porta certa. */
  ports?: VelixManifestPort[];
  /** Sinalizadores que a análise de segurança verifica antes de permitir implantar. */
  privileged?: boolean;
  networkMode?: 'host' | 'bridge';
  dockerSocket?: boolean;
  /** Serviço opcional — o usuário escolhe incluir ou não na etapa "Componentes" do
   * assistente. Serviços sem essa flag (ou `false`) são sempre incluídos. */
  optional?: boolean;
  /** Nomes de outros serviços do mesmo manifesto que este serviço precisa pra funcionar
   * — viram `depends_on` no compose renderizado. Se um serviço opcional depende de outro
   * opcional ainda não selecionado, `resolveIncludedServices` inclui a dependência junto. */
  dependsOn?: string[];
}

export interface VelixManifestSecret {
  /** Referenciada como `{{secret:CHAVE}}` no `environment` de qualquer serviço do manifesto. */
  key: string;
  /** Bytes de aleatoriedade (base64url) — padrão 24 (~32 caracteres). */
  length?: number;
}

export interface VelixManifest {
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;
  icon: string;
  author: string;
  documentationUrl?: string;
  /** Repositório do projeto — mostrado na tela de detalhes do catálogo. */
  repositoryUrl?: string;
  /** Site oficial, quando diferente da documentação. */
  websiteUrl?: string;
  /** Capturas de tela do próprio projeto. Só URLs de fontes que o projeto já
   * publica (README no GitHub, site oficial) — o Velix não hospeda imagem de
   * aplicação de terceiro. */
  screenshots?: string[];
  minResources: { memoryMb: number };
  services: VelixManifestService[];
  /** Segredos gerados uma vez no deploy e injetados via arquivo de env (nunca no compose salvo). */
  secrets?: VelixManifestSecret[];
  /** Nome do serviço (em `services`) que recebe o domínio quando o usuário associa um. */
  primaryService: string;
  /** Porta dentro do container que o Traefik roteia (mesma coisa que o `ports[].recommended`
   * do `primaryService` — mantido pra compatibilidade com os manifestos de fase anterior). */
  primaryPort: number;
}

export type SecurityRiskLevel = 'low' | 'medium' | 'high' | 'blocked';

export interface SecurityFinding {
  level: SecurityRiskLevel;
  message: string;
}

/** Analisa o manifesto por sinais de risco conhecidos antes de permitir a implantação. */
export function scanSecurityRisks(manifest: VelixManifest): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const service of manifest.services) {
    if (service.privileged) {
      findings.push({ level: 'blocked', message: `Serviço "${service.name}" pede modo privileged — bloqueado por padrão.` });
    }
    if (service.networkMode === 'host') {
      findings.push({ level: 'high', message: `Serviço "${service.name}" usa network_mode: host — expõe todas as portas do servidor.` });
    }
    if (service.dockerSocket) {
      findings.push({
        level: 'medium',
        message: `Serviço "${service.name}" acessa o socket do Docker — dá controle total sobre containers do servidor. Necessário pra ferramentas de gerenciamento de containers; confirme que confia na imagem.`,
      });
    }
    if (/:latest$/.test(service.image) || !service.image.includes(':')) {
      findings.push({ level: 'low', message: `Serviço "${service.name}" não fixa uma versão da imagem (tag "latest").` });
    }
  }
  return findings;
}

export function highestRiskLevel(findings: SecurityFinding[]): SecurityRiskLevel {
  if (findings.some((f) => f.level === 'blocked')) return 'blocked';
  if (findings.some((f) => f.level === 'high')) return 'high';
  if (findings.some((f) => f.level === 'medium')) return 'medium';
  if (findings.some((f) => f.level === 'low')) return 'low';
  return 'low';
}

export interface ManifestValidation {
  ok: boolean;
  errors: string[];
}

/** Validação estrutural — o manifesto referencia o que diz referenciar. */
export function validateManifest(manifest: VelixManifest): ManifestValidation {
  const errors: string[] = [];
  if (manifest.services.length === 0) errors.push('Manifesto sem nenhum serviço.');
  if (!manifest.services.some((s) => s.name === manifest.primaryService)) {
    errors.push(`primaryService "${manifest.primaryService}" não corresponde a nenhum serviço declarado.`);
  }
  const names = new Set<string>();
  for (const s of manifest.services) {
    if (names.has(s.name)) errors.push(`Nome de serviço duplicado: "${s.name}".`);
    names.add(s.name);
    if (!s.image.trim()) errors.push(`Serviço "${s.name}" sem imagem.`);
  }
  for (const s of manifest.services) {
    for (const dep of s.dependsOn ?? []) {
      if (!names.has(dep)) errors.push(`Serviço "${s.name}" depende de "${dep}", que não existe no manifesto.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Serviços sempre incluídos no deploy (não aparecem como opção no assistente). */
export function requiredServices(manifest: VelixManifest): VelixManifestService[] {
  return manifest.services.filter((s) => !s.optional);
}

/** Serviços que o usuário pode escolher incluir ou não na etapa "Componentes". */
export function optionalServices(manifest: VelixManifest): VelixManifestService[] {
  return manifest.services.filter((s) => s.optional);
}

/**
 * Obrigatórios + opcionais escolhidos, com as dependências deles resolvidas em
 * cascata (se um opcional selecionado depende de outro opcional, este último
 * entra junto mesmo sem estar na lista — senão o compose citaria um serviço
 * ausente). Ordem não importa aqui, só o conjunto final.
 */
export function resolveIncludedServices(manifest: VelixManifest, selectedOptional: string[] = []): VelixManifestService[] {
  const byName = new Map(manifest.services.map((s) => [s.name, s]));
  const included = new Set<string>(requiredServices(manifest).map((s) => s.name));
  for (const name of selectedOptional) if (byName.has(name)) included.add(name);

  let changed = true;
  while (changed) {
    changed = false;
    for (const name of Array.from(included)) {
      for (const dep of byName.get(name)?.dependsOn ?? []) {
        if (!included.has(dep)) {
          included.add(dep);
          changed = true;
        }
      }
    }
  }

  return manifest.services.filter((s) => included.has(s.name));
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

const SECRET_REF = /\{\{secret:([A-Za-z0-9_]+)\}\}/g;
const SERVICE_REF = /\{\{service:([A-Za-z0-9_-]+)\}\}/g;
const VAR_REF = /\{\{var:([A-Za-z0-9_]+)\}\}/g;

/** Resolve `{{secret:CHAVE}}`, `{{service:NOME}}` e `{{var:CHAVE}}` num valor de variável de ambiente. */
export function interpolate(
  value: string,
  appSlug: string,
  secretsMap: Record<string, string>,
  variablesMap: Record<string, string> = {},
): string {
  return value
    .replace(SECRET_REF, (_, key) => secretsMap[key] ?? '')
    .replace(SERVICE_REF, (_, name) => `${appSlug}_${name}`)
    .replace(VAR_REF, (_, key) => variablesMap[key] ?? '');
}

/** Junta o valor enviado pelo usuário com o padrão de cada variável declarada no manifesto. */
export function resolveVariables(manifest: VelixManifest, userValues: Record<string, string> = {}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of manifest.services) {
    for (const v of s.variables ?? []) map[v.key] = userValues[v.key] ?? v.default ?? '';
  }
  return map;
}

/** Todas as variáveis configuráveis do manifesto (todos os serviços), pra montar o formulário do assistente. */
export function allVariables(manifest: VelixManifest): VelixManifestVariable[] {
  return manifest.services.flatMap((s) => s.variables ?? []);
}

/** Único ponto impuro deste arquivo — geração de senha/token aleatório de verdade. */
export function generateSecretValue(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/** Gera o valor de cada segredo declarado no manifesto (uma vez por deploy) —
 * ou usa o valor que o usuário digitou, quando ele escolheu não deixar
 * gerar automático (ex.: senha root customizada na hora de criar um banco). */
export function resolveSecrets(manifest: VelixManifest, overrides: Record<string, string> = {}): Record<string, string> {
  const map: Record<string, string> = {};
  for (const s of manifest.secrets ?? []) map[s.key] = overrides[s.key]?.trim() || generateSecretValue(s.length);
  return map;
}

function renderEnvironment(env: Record<string, string> | undefined, appSlug: string, variablesMap: Record<string, string>): string {
  if (!env || Object.keys(env).length === 0) return '';
  const lines = Object.entries(env).map(([k, v]) => `  - ${k}=${interpolate(v, appSlug, {}, variablesMap)}`);
  return `\n    environment:\n${indent(lines.join('\n'), 2)}`;
}

function renderVolumes(appSlug: string, volumes?: VelixManifestVolume[]): string {
  if (!volumes || volumes.length === 0) return '';
  const lines = volumes.map((v) => `  - ${appSlug}_${v.name}:${v.containerPath}`);
  return `\n    volumes:\n${indent(lines.join('\n'), 2)}`;
}

/**
 * Renderiza o docker-compose.yml da implantação — string pura, sem I/O.
 * Quando o manifesto declara segredos, NENHUM serviço leva `environment:` inline
 * (mesmo os sem segredo) — todos passam por `env_file` pra manter o compose
 * salvo em texto puro no banco livre de qualquer valor sensível. Os arquivos de
 * env de verdade (com os valores resolvidos) são gerados por `renderServiceEnvFiles`
 * e escritos no servidor separadamente, nunca guardados no banco.
 */
function renderDependsOn(dependsOn: string[] | undefined, includedNames: Set<string>): string {
  const deps = (dependsOn ?? []).filter((d) => includedNames.has(d));
  if (deps.length === 0) return '';
  return `\n    depends_on:\n${deps.map((d) => `      - ${d}`).join('\n')}`;
}

/** Publica a porta do container num host port — usado só quando o usuário
 * pede explicitamente ("Publicar porta" na tela do serviço), pra acessar o
 * banco direto de um cliente de fora sem passar pelo Traefik (que só roteia
 * HTTP/HTTPS, não protocolos de banco). Sem isso, todo serviço fica só na
 * rede interna `velix-proxy`, de propósito (menos superfície exposta). */
function renderHostPort(hostPort: number | undefined, containerPort: number | undefined): string {
  if (!hostPort || !containerPort) return '';
  return `\n    ports:\n      - "${hostPort}:${containerPort}"`;
}

export function renderCompose(
  manifest: VelixManifest,
  appSlug: string,
  variablesMap: Record<string, string> = {},
  selectedOptional: string[] = [],
  hostPorts: Record<string, number> = {},
  /** Nome real do volume Docker já existente a reaproveitar em vez de criar um
   * novo (chave = nome do volume no manifesto, ex.: "db-data") — usado só ao
   * mover um deployment pra outro projeto (`moveDeployment`). Sem isso, o
   * volume nasceria vazio com o nome derivado do slug novo, perdendo acesso
   * aos dados gravados sob o slug antigo. */
  volumeNameOverrides: Record<string, string> = {},
): string {
  const usesSecrets = (manifest.secrets?.length ?? 0) > 0;
  const included = resolveIncludedServices(manifest, selectedOptional);
  const includedNames = new Set(included.map((s) => s.name));

  const serviceBlocks = included
    .map((s) => {
      const containerName = `${appSlug}_${s.name}`;
      const command = s.command ? `\n    command: ${s.command}` : '';
      const envBlock =
        usesSecrets && s.environment && Object.keys(s.environment).length > 0
          ? `\n    env_file:\n      - ./secrets/${s.name}.env`
          : renderEnvironment(s.environment, appSlug, variablesMap);
      const portBlock = renderHostPort(hostPorts[s.name], s.ports?.find((p) => p.recommended)?.port ?? s.ports?.[0]?.port);
      return `  ${s.name}:
    image: ${s.image}
    container_name: ${containerName}
    restart: unless-stopped${command}${envBlock}${renderVolumes(appSlug, s.volumes)}${renderDependsOn(s.dependsOn, includedNames)}${portBlock}
    networks:
      - velix-proxy`;
    })
    .join('\n\n');

  // Nome de volume repetido entre serviços (ex.: `app` e `cron` compartilhando o
  // mesmo diretório do Nextcloud) deve virar UM volume top-level só, não um por serviço.
  const volumeNames = Array.from(new Set(included.flatMap((s) => s.volumes ?? []).map((v) => v.name)));
  const volumesBlock =
    volumeNames.length > 0
      ? `\nvolumes:\n${volumeNames
          .map((n) => (volumeNameOverrides[n] ? `  ${appSlug}_${n}:\n    name: ${volumeNameOverrides[n]}` : `  ${appSlug}_${n}:`))
          .join('\n')}\n`
      : '';

  return `services:
${serviceBlocks}
${volumesBlock}
networks:
  velix-proxy:
    external: true
`;
}

/** Conteúdo de cada arquivo `secrets/<serviço>.env` — com os valores JÁ resolvidos.
 * Só existe quando o manifesto declara segredos (ver `renderCompose`). */
export function renderServiceEnvFiles(
  manifest: VelixManifest,
  appSlug: string,
  secretsMap: Record<string, string>,
  variablesMap: Record<string, string> = {},
  selectedOptional: string[] = [],
): Record<string, string> {
  if (!manifest.secrets || manifest.secrets.length === 0) return {};
  const included = resolveIncludedServices(manifest, selectedOptional);
  const files: Record<string, string> = {};
  for (const s of included) {
    if (!s.environment || Object.keys(s.environment).length === 0) continue;
    const lines = Object.entries(s.environment).map(([k, v]) => `${k}=${interpolate(v, appSlug, secretsMap, variablesMap)}`);
    files[s.name] = lines.join('\n') + '\n';
  }
  return files;
}

const DB_NAME_ENV_KEYS = ['MYSQL_DATABASE', 'MARIADB_DATABASE', 'POSTGRES_DB'];

/**
 * Nome real do banco de um serviço implantado — lê o valor efetivo da env que
 * define o banco no manifesto, em vez de assumir que existe uma variável
 * `DATABASE_NAME` preenchida pelo usuário. Vários manifestos do catálogo
 * fixam o nome do banco direto no `environment` (ex.: Ghost, WordPress,
 * Nextcloud usam `MYSQL_DATABASE: 'ghost'`/`'wordpress'`/`'nextcloud'`, sem
 * variável nenhuma) — backup, console, túnel e import de `.sql` caíam todos
 * no fallback errado `'app'` pra esses bancos e falhavam com "Unknown
 * database". `'app'` continua sendo o fallback final: cobre implantações Git
 * (sem manifesto) e o caso normal de `DATABASE_NAME` como variável mesmo.
 */
export function resolvedDatabaseName(
  manifest: VelixManifest | null,
  serviceName: string,
  variablesMap: Record<string, string> = {},
): string {
  const service = manifest?.services.find((s) => s.name === serviceName);
  const envKey = DB_NAME_ENV_KEYS.find((k) => service?.environment?.[k]);
  const resolved = envKey ? interpolate(service!.environment![envKey], '', {}, variablesMap) : '';
  return resolved || variablesMap.DATABASE_NAME || 'app';
}

/** Nome do container que recebe tráfego do Traefik quando um domínio é associado. */
export function primaryContainerName(manifest: VelixManifest, appSlug: string): string {
  return `${appSlug}_${manifest.primaryService}`;
}

/** Portas internas conhecidas de um serviço (do manifesto), com a recomendada primeiro. */
export function servicePorts(manifest: VelixManifest, serviceName: string): VelixManifestPort[] {
  const service = manifest.services.find((s) => s.name === serviceName);
  const ports = service?.ports ?? [];
  return [...ports].sort((a, b) => Number(!!b.recommended) - Number(!!a.recommended));
}
