/** Funções puras do fluxo de implantação a partir de repositório Git — sem I/O,
 * testáveis sem servidor. Ver git-source.util.spec.ts. */

export type BuildMethod = 'dockerfile' | 'nixpacks';

export interface GitSource {
  repoUrl: string;
  gitRef: string;
  buildMethod: BuildMethod;
  dockerfilePath?: string;
  token?: string;
}

const ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];

/**
 * Só HTTPS e só forjas conhecidas.
 *
 * A URL entra num comando `git clone` executado por SSH no servidor do usuário.
 * Aceitar esquemas arbitrários abriria `ext::`, `file://` e afins — o transporte
 * `ext::` do git executa um comando local, o que transformaria este campo numa
 * execução remota de comando disfarçada de URL. Restringir a lista é mais
 * simples e mais seguro que tentar escapar tudo depois.
 */
export function validateRepoUrl(raw: string): { ok: true; url: string; host: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Informe a URL completa do repositório (ex.: https://github.com/usuario/projeto)' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Use uma URL https:// — outros esquemas não são aceitos por segurança' };
  }
  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return { ok: false, error: `Repositórios são aceitos apenas de: ${ALLOWED_HOSTS.join(', ')}` };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Não coloque usuário ou senha na URL — use o campo de token de acesso' };
  }
  // Sem query nem fragmento: nada além de host + caminho tem sentido aqui, e
  // deixar passar só amplia o que precisa ser validado.
  const path = parsed.pathname.replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(path)) {
    return { ok: false, error: 'Caminho do repositório inválido — esperado usuário/projeto' };
  }

  return { ok: true, url: `https://${parsed.hostname}/${path}.git`, host: parsed.hostname };
}

/** Branch, tag ou commit. Sem espaços nem caracteres que o shell interprete. */
export function validateGitRef(raw: string): boolean {
  const ref = raw.trim();
  if (!ref || ref.length > 120) return false;
  if (/^-/.test(ref)) return false; // não pode virar flag do git
  return /^[A-Za-z0-9._\/-]+$/.test(ref);
}

/** Caminho relativo dentro do repositório, sem escapar dele. */
export function validateDockerfilePath(raw: string): boolean {
  const path = raw.trim();
  if (!path || path.length > 200) return false;
  if (path.startsWith('/') || path.includes('..')) return false;
  return /^[A-Za-z0-9._\/-]+$/.test(path);
}

/**
 * URL de clone com o token embutido, para repositório privado.
 *
 * Vai para dentro de um comando remoto, então o token é codificado — um `@` ou
 * `/` no meio dele quebraria o parsing da URL e vazaria pedaços do segredo pro
 * lugar errado. O formato `x-access-token:<token>@host` é o que GitHub, GitLab
 * e Bitbucket aceitam para tokens pessoais.
 */
export function cloneUrlWithToken(url: string, token?: string): string {
  if (!token?.trim()) return url;
  const parsed = new URL(url);
  return `https://x-access-token:${encodeURIComponent(token.trim())}@${parsed.hostname}${parsed.pathname}`;
}

/** Esconde o token de qualquer linha de log antes dela chegar ao navegador. */
export function redactToken(line: string, token?: string): string {
  if (!token?.trim()) return line;
  const encoded = encodeURIComponent(token.trim());
  return line.split(token.trim()).join('***').split(encoded).join('***');
}

export interface RenderGitComposeOptions {
  slug: string;
  image: string;
  port: number;
  env: Record<string, string>;
  volumes: { name: string; containerPath: string }[];
  proxyNetwork: string;
}

/**
 * Compose de uma aplicação construída a partir de código: um serviço só, com a
 * imagem já construída no servidor. Não reaproveita `renderCompose` do catálogo
 * porque lá a fonte é sempre uma imagem de registro e o formato é dirigido pelo
 * manifesto — aqui não há manifesto nenhum.
 */
export function renderGitCompose(opts: RenderGitComposeOptions): string {
  const container = `${opts.slug}_app`;
  const lines = [
    'services:',
    '  app:',
    `    image: ${opts.image}`,
    `    container_name: ${container}`,
    '    restart: unless-stopped',
  ];

  const envEntries = Object.entries(opts.env);
  if (envEntries.length > 0) {
    lines.push('    environment:');
    for (const [key, value] of envEntries) {
      // Aspas simples com escape de aspa simples: valor do usuário não pode
      // encerrar a string e injetar chave YAML nova.
      lines.push(`      ${key}: '${String(value).split("'").join("''")}'`);
    }
  }

  if (opts.volumes.length > 0) {
    lines.push('    volumes:');
    for (const v of opts.volumes) lines.push(`      - ${opts.slug}_${v.name}:${v.containerPath}`);
  }

  lines.push('    expose:', `      - "${opts.port}"`);
  lines.push('    networks:', `      - ${opts.proxyNetwork}`);

  if (opts.volumes.length > 0) {
    lines.push('', 'volumes:');
    for (const v of opts.volumes) lines.push(`  ${opts.slug}_${v.name}:`, `    name: ${opts.slug}_${v.name}`);
  }

  lines.push('', 'networks:', `  ${opts.proxyNetwork}:`, '    external: true');

  return lines.join('\n') + '\n';
}
