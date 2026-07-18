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

  private cache: { channel: UpdateChannel; result: ReleaseCheckResult; expiresAt: number } | null = null;

  async getLatestRelease(channel: UpdateChannel, opts: { force?: boolean } = {}): Promise<ReleaseCheckResult> {
    if (!opts.force && this.cache && this.cache.channel === channel && this.cache.expiresAt > Date.now()) {
      return this.cache.result;
    }
    const result = await this.fetchLatestRelease(channel);
    this.cache = { channel, result, expiresAt: Date.now() + CACHE_TTL_MS };
    return result;
  }

  private async fetchLatestRelease(channel: UpdateChannel): Promise<ReleaseCheckResult> {
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

    const releases = (await res.json()) as GitHubRelease[];
    const release = this.pickForChannel(
      releases.filter((r) => !r.draft),
      channel,
    );

    return { ok: true, release: release ? this.toReleaseInfo(release, channel) : null };
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
