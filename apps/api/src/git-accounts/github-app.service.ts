import { BadGatewayException, BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { buildManifest } from './github-app.util';

interface ManifestConversion {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string;
  pem: string;
}

interface StoredCredentials {
  clientId: string;
  clientSecret: string;
  privateKeyPem: string;
  webhookSecret: string;
}

interface InstallationTokenResponse {
  token: string;
}

interface GitHubRepo {
  full_name: string;
  private: boolean;
  default_branch: string;
}

interface GitHubBranch {
  name: string;
}

const GITHUB_API = 'https://api.github.com';

/**
 * Conecta uma conta do GitHub sem o usuário precisar gerar um token à mão:
 * o Velix registra um GitHub App novo pra essa conexão (fluxo de manifest —
 * https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest)
 * e depois pede pra instalar esse App nos repositórios desejados. Três
 * passos, cada um uma ida e volta com o navegador do usuário — ver
 * github-app-callback.controller.ts pros dois de retorno.
 *
 * O `state` de cada etapa é um JWT assinado com o mesmo segredo/serviço já
 * usado pro login (`JwtService`/`JWT_SECRET`) — sem tabela nova pra guardar
 * pedidos pendentes, e sem novo segredo pra gerenciar. Curta duração (15min)
 * porque o usuário faz tudo isso numa sessão só, em segundos a minutos.
 */
@Injectable()
export class GitHubAppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private webOrigin(): string {
    const origin = process.env.WEB_ORIGIN;
    if (!origin) {
      throw new BadRequestException('O endereço público do painel (WEB_ORIGIN) não está configurado — conectar com o GitHub precisa dele.');
    }
    return origin;
  }

  /** Etapa 1: monta o manifest + a URL pra onde o navegador deve ser enviado. */
  async startManifest(label: string) {
    const trimmed = label?.trim();
    if (!trimmed) throw new BadRequestException('Dê um nome para identificar esta conta');

    const webOrigin = this.webOrigin();
    const randomSuffix = randomBytes(4).toString('hex');
    const manifest = buildManifest({ label: trimmed, randomSuffix, webOrigin });
    const state = await this.jwt.signAsync({ purpose: 'github-app-create', label: trimmed }, { expiresIn: '15m' });

    return {
      manifest,
      targetUrl: `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`,
    };
  }

  /** Etapa 2 (callback público — ver github-app-callback.controller.ts): o
   * App acabou de ser criado no GitHub. Troca o `code` temporário pelas
   * credenciais reais, salva a conta (ainda sem instalação) e devolve a URL
   * pra instalar o App em repositórios. */
  async handleAppCreated(code: string, state: string) {
    const payload = await this.verifyState(state, 'github-app-create');

    const res = await fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      throw new BadGatewayException('O GitHub recusou a criação do App — tente conectar de novo.');
    }
    const data = (await res.json()) as ManifestConversion;

    const credentials: StoredCredentials = {
      clientId: data.client_id,
      clientSecret: data.client_secret,
      privateKeyPem: data.pem,
      webhookSecret: data.webhook_secret,
    };

    const account = await this.prisma.gitAccount.create({
      data: {
        label: payload.label,
        host: 'github.com',
        authMethod: 'github_app',
        githubAppId: String(data.id),
        githubAppSlug: data.slug,
        credentialsEnc: encryptCredential(JSON.stringify(credentials)),
      },
    });

    const installState = await this.jwt.signAsync({ purpose: 'github-app-install', accountId: account.id }, { expiresIn: '15m' });
    return { installUrl: `https://github.com/apps/${data.slug}/installations/new?state=${encodeURIComponent(installState)}` };
  }

  /** Etapa 3 (callback público): o usuário terminou de escolher em quais
   * repositórios instalar o App. Grava o `installationId` — só a partir
   * daqui a conta consegue gerar token pra clonar de verdade. */
  async handleInstalled(installationId: string, state: string) {
    const payload = await this.verifyState(state, 'github-app-install');
    if (!installationId) throw new BadRequestException('installation_id ausente na resposta do GitHub');

    const account = await this.prisma.gitAccount.findUnique({ where: { id: payload.accountId } });
    if (!account) throw new NotFoundException('Conta do GitHub não encontrada — o passo anterior pode ter expirado');

    await this.prisma.gitAccount.update({
      where: { id: account.id },
      data: { installationId },
    });
  }

  /** Token de instalação de curta duração (~1h, a mesma validade que o
   * GitHub dá) — gerado a cada chamada, nunca guardado: diferente de um PAT,
   * expira rápido, então não faz sentido cifrar e reaproveitar do banco. */
  async resolveInstallationToken(account: { id: string; installationId: string | null; githubAppId: string | null; credentialsEnc: string | null }): Promise<string> {
    if (!account.installationId || !account.githubAppId || !account.credentialsEnc) {
      throw new BadRequestException('Esta conta do GitHub ainda não terminou a instalação — reconecte em Configurações.');
    }
    const credentials = JSON.parse(decryptCredential(account.credentialsEnc)) as StoredCredentials;

    const appJwt = await this.jwt.signAsync(
      {},
      {
        algorithm: 'RS256',
        privateKey: credentials.privateKeyPem,
        issuer: account.githubAppId,
        expiresIn: '10m',
      },
    );

    const res = await fetch(`${GITHUB_API}/app/installations/${account.installationId}/access_tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${appJwt}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      throw new BadGatewayException('Falha ao gerar token de acesso do GitHub App — a instalação pode ter sido revogada do lado do GitHub.');
    }
    const data = (await res.json()) as InstallationTokenResponse;
    return data.token;
  }

  /** Repositórios que a instalação enxerga — pra trocar "cole a URL" por
   * "escolha da lista" no assistente de implantar do repositório. */
  async listRepositories(accountId: string): Promise<{ fullName: string; private: boolean; defaultBranch: string }[]> {
    const account = await this.getGitHubAppAccount(accountId);
    const token = await this.resolveInstallationToken(account);

    const res = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new BadGatewayException('Falha ao listar repositórios da instalação do GitHub.');
    const data = (await res.json()) as { repositories: GitHubRepo[] };
    return data.repositories.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch }));
  }

  /** Branches de UM repositório dentro da instalação — `owner/repo` já
   * validado no controller (mesmo formato aceito por validateRepoUrl). */
  async listBranches(accountId: string, owner: string, repo: string): Promise<string[]> {
    const account = await this.getGitHubAppAccount(accountId);
    const token = await this.resolveInstallationToken(account);

    const res = await fetch(`${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new BadGatewayException('Falha ao listar branches do repositório.');
    const data = (await res.json()) as GitHubBranch[];
    return data.map((b) => b.name);
  }

  private async getGitHubAppAccount(accountId: string) {
    const account = await this.prisma.gitAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException('Conta do GitHub não encontrada');
    if (account.authMethod !== 'github_app') {
      throw new BadRequestException('Listar repositórios só está disponível para contas conectadas via "Conectar com GitHub"');
    }
    return account;
  }

  private async verifyState(state: string, expectedPurpose: string): Promise<any> {
    if (!state) throw new UnauthorizedException('Requisição inválida — falta o state');
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(state);
    } catch {
      throw new UnauthorizedException('Link expirado ou inválido — tente conectar de novo');
    }
    if (payload?.purpose !== expectedPurpose) {
      throw new UnauthorizedException('Requisição inválida');
    }
    return payload;
  }
}
