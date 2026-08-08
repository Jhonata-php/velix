import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';

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
 * O token nunca sai daqui em claro: as respostas levam só rótulo, host e os
 * quatro últimos caracteres — o bastante pra identificar qual é sem permitir
 * reconstruí-lo. Quem precisa do valor real é o serviço de implantação, que
 * chama `resolveToken` internamente.
 */
@Injectable()
export class GitAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublic(account: { id: string; label: string; host: string; username: string | null; tokenHint: string; createdAt: Date }) {
    return {
      id: account.id,
      label: account.label,
      host: account.host,
      username: account.username,
      tokenHint: account.tokenHint,
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
    // que impedir.
    const inUse = await this.prisma.projectDeployment.count({ where: { gitAccountId: id } });
    await this.prisma.gitAccount.delete({ where: { id } });
    return { ok: true, applicationsAffected: inUse };
  }

  /** Valor real do token — só para uso interno do motor de implantação. */
  async resolveToken(id: string): Promise<string> {
    const account = await this.prisma.gitAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Conta do repositório não encontrada');
    return decryptCredential(account.tokenEnc);
  }
}
