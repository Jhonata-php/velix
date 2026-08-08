import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { GitHubAppService } from './github-app.service';

const SUPPORTED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'];

export interface CreateGitAccountInput {
  label: string;
  host?: string;
  username?: string;
  token: string;
}

/**
 * Contas de forja salvas, para não redigitar o mesmo token a cada implantação.
 *
 * Duas origens possíveis: `authMethod: 'token'` (Personal Access Token
 * colado à mão, qualquer host suportado) ou `authMethod: 'github_app'`
 * (App auto-registrado via manifest, só github.com — ver
 * github-app.service.ts). O token/credencial real nunca sai daqui em claro:
 * as respostas levam só rótulo, host e os quatro últimos caracteres (contas
 * de token) ou o slug do App (contas GitHub App) — o bastante pra
 * identificar qual é sem permitir reconstruir o segredo. Quem precisa do
 * valor real é o motor de implantação, que chama `resolveToken` internamente.
 */
@Injectable()
export class GitAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubApp: GitHubAppService,
  ) {}

  private toPublic(account: {
    id: string;
    label: string;
    host: string;
    username: string | null;
    authMethod: string;
    tokenHint: string | null;
    githubAppSlug: string | null;
    createdAt: Date;
  }) {
    return {
      id: account.id,
      label: account.label,
      host: account.host,
      username: account.username,
      authMethod: account.authMethod,
      tokenHint: account.tokenHint,
      githubAppSlug: account.githubAppSlug,
      createdAt: account.createdAt,
    };
  }

  async list() {
    const accounts = await this.prisma.gitAccount.findMany({ orderBy: { createdAt: 'desc' } });
    return accounts.map((a) => this.toPublic(a));
  }

  async create(dto: CreateGitAccountInput) {
    const label = dto.label?.trim();
    const token = dto.token?.trim();
    const host = (dto.host ?? 'github.com').trim();

    if (!label) throw new BadRequestException('Dê um nome para identificar esta conta');
    if (!token) throw new BadRequestException('Informe o token de acesso');
    if (!SUPPORTED_HOSTS.includes(host)) {
      throw new BadRequestException(`Host não suportado. Aceitos: ${SUPPORTED_HOSTS.join(', ')}`);
    }

    const account = await this.prisma.gitAccount.create({
      data: {
        label,
        host,
        username: dto.username?.trim() || null,
        authMethod: 'token',
        tokenEnc: encryptCredential(token),
        tokenHint: token.slice(-4),
      },
    });
    return this.toPublic(account);
  }

  async remove(id: string) {
    const account = await this.prisma.gitAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Conta não encontrada');

    // Implantações que usavam esta conta continuam existindo (onDelete:
    // SetNull); elas só param de conseguir clonar de novo. Avisar é melhor
    // que impedir. Contas de GitHub App não têm o App/instalação desfeitos
    // do lado do GitHub aqui — só o registro local some; o usuário pode
    // desinstalar manualmente em github.com/settings/installations.
    const inUse = await this.prisma.projectDeployment.count({ where: { gitAccountId: id } });
    await this.prisma.gitAccount.delete({ where: { id } });
    return { ok: true, applicationsAffected: inUse };
  }

  /** Valor real do token — só para uso interno do motor de implantação. */
  async resolveToken(id: string): Promise<string> {
    const account = await this.prisma.gitAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Conta do repositório não encontrada');
    if (account.authMethod === 'github_app') {
      return this.githubApp.resolveInstallationToken(account);
    }
    if (!account.tokenEnc) throw new BadRequestException('Esta conta não tem um token configurado');
    return decryptCredential(account.tokenEnc);
  }
}
