import { Injectable, Logger } from '@nestjs/common';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

export type UpdateChannel = 'stable' | 'beta' | 'nightly';

export interface ReleaseInfo {
  version: string;
  tagName: string;
  channel: UpdateChannel;
  publishedAt: string | null;
  url: string;
  /** HTML já sanitizado — seguro pra `dangerouslySetInnerHTML` sem sanitização extra no frontend. */
  changelogHtml: string;
  prerelease: boolean;
}

export type ReleaseCheckResult =
  | { ok: true; release: ReleaseInfo | null }
  | { ok: false; error: string };

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
}

// 10min: poupa o limite de requisições do GitHub (60/h sem token, 5000/h com
// token) — a tela de Atualizações pode ser aberta várias vezes por hora.
const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class GitHubReleaseService {
  private readonly logger = new Logger(GitHubReleaseService.name);
  private readonly owner = process.env.UPDATE_REPO_OWNER?.trim() || 'Jhonata-php';
  private readonly repo = process.env.UPDATE_REPO_NAME?.trim() || 'velix';
  // Token nunca sai daqui — os controllers só devolvem ReleaseInfo/erros, nunca o header/token em si.
  private readonly token = process.env.UPDATE_GITHUB_TOKEN?.trim() || null;

  // Cacheado no nível mais baixo (a resposta crua do GitHub), não em cada
  // método derivado — `getLatestRelease` e `listReleases` já se pegaram
  // discordando entre si porque cada um cacheava (ou não) o próprio
  // resultado já filtrado: o card do topo (getLatestRelease, cacheado 10min)
  // mostrava uma versão pra trás enquanto o histórico (listReleases, sem
  // cache algum) já batia direto no GitHub e mostrava a release nova. Com o
  // cache aqui embaixo, os dois sempre leem exatamente o mesmo snapshot.
  private rawCache: { result: { ok: true; releases: GitHubRelease[] } | { ok: false; error: string }; expiresAt: number } | null = null;

  async getLatestRelease(channel: UpdateChannel, opts: { force?: boolean } = {}): Promise<ReleaseCheckResult> {
    const raw = await this.fetchRaw(opts.force);
    if (!raw.ok) return { ok: false, error: raw.error };

    const release = this.pickForChannel(
      raw.releases.filter((r) => !r.draft),
      channel,
    );
    return { ok: true, release: release ? this.toReleaseInfo(release, channel) : null };
  }

  /** Todas as releases publicadas, não só a mais recente — mesmo `fetchRaw`
   * cacheado de `getLatestRelease`, só filtra diferente. */
  async listReleases(channel: UpdateChannel): Promise<{ ok: true; releases: ReleaseInfo[] } | { ok: false; error: string }> {
    const raw = await this.fetchRaw();
    if (!raw.ok) return { ok: false, error: raw.error };

    const releases = raw.releases
      .filter((r) => !r.draft)
      .filter((r) => (channel === 'nightly' ? true : !/nightly/i.test(r.tag_name)))
      .filter((r) => (channel === 'stable' ? !r.prerelease : true))
      .map((r) => this.toReleaseInfo(r, channel));

    return { ok: true, releases };
  }

  /**
   * Uma única função conversa com o GitHub. Cache aqui (não em cada chamador)
   * é o que garante `getLatestRelease`/`listReleases` nunca discordarem entre
   * si — e a lógica de erro (404, 401, rate limit, timeout) existe uma vez só.
   */
  private async fetchRaw(force = false): Promise<{ ok: true; releases: GitHubRelease[] } | { ok: false; error: string }> {
    if (!force && this.rawCache && this.rawCache.expiresAt > Date.now()) {
      return this.rawCache.result;
    }

    const result = await this.requestReleases();
    // Cacheia sucesso E erro (mesmo comportamento de antes) — um erro de rate
    // limit/rede não deve disparar uma nova tentativa a cada request dentro
    // da mesma janela de 10min.
    this.rawCache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }

  private async requestReleases(): Promise<{ ok: true; releases: GitHubRelease[] } | { ok: false; error: string }> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/releases?per_page=30`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'velix-update-center',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      });
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === 'AbortError';
      this.logger.warn(`Falha ao consultar GitHub Releases: ${err instanceof Error ? err.message : err}`);
      return {
        ok: false,
        error: timedOut ? 'Tempo esgotado ao consultar o GitHub.' : 'Não foi possível conectar ao GitHub.',
      };
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 404) {
      return { ok: false, error: 'Repositório não encontrado ou é privado. Configure UPDATE_GITHUB_TOKEN.' };
    }
    if (res.status === 401) {
      return { ok: false, error: 'Token do GitHub inválido ou expirado.' };
    }
    if (res.status === 403) {
      if (res.headers.get('x-ratelimit-remaining') === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset') ?? '0');
        this.logger.warn(`Rate limit do GitHub atingido (reset: ${reset ? new Date(reset * 1000).toISOString() : 'desconhecido'})`);
        return { ok: false, error: 'Limite de requisições do GitHub atingido. Tente novamente mais tarde.' };
      }
      return { ok: false, error: 'Acesso negado pelo GitHub ao consultar releases.' };
    }
    if (!res.ok) {
      this.logger.warn(`GitHub Releases respondeu ${res.status}`);
      return { ok: false, error: `GitHub respondeu com erro (${res.status}).` };
    }

    return { ok: true, releases: (await res.json()) as GitHubRelease[] };
  }

  private pickForChannel(releases: GitHubRelease[], channel: UpdateChannel): GitHubRelease | undefined {
    // GitHub não tem conceito nativo de canal — usamos tag/prerelease como proxy:
    // nightly = tag contém "nightly"; stable = não-prerelease e não-nightly;
    // beta = qualquer release mais recente que não seja nightly (cai pra stable
    // quando não há prerelease publicado, o que é o comportamento correto).
    if (channel === 'nightly') {
      return releases.find((r) => /nightly/i.test(r.tag_name));
    }
    if (channel === 'beta') {
      return releases.find((r) => !/nightly/i.test(r.tag_name));
    }
    return releases.find((r) => !r.prerelease && !/nightly/i.test(r.tag_name));
  }

  private toReleaseInfo(release: GitHubRelease, channel: UpdateChannel): ReleaseInfo {
    return {
      version: release.tag_name.replace(/^v/i, ''),
      tagName: release.tag_name,
      channel,
      publishedAt: release.published_at,
      url: release.html_url,
      changelogHtml: renderChangelog(release.body),
      prerelease: release.prerelease,
    };
  }
}

function renderChangelog(markdown: string | null): string {
  if (!markdown) return '';
  const rawHtml = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'img']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ['src', 'alt'],
      a: ['href', 'name', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
  });
}
