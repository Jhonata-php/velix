import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

/**
 * Trava a conta depois de tentativas falhas seguidas.
 *
 * O rate limit que já existia é por IP — não impede força bruta distribuída,
 * que é justamente como o ataque real acontece. Aqui a chave é o e-mail, então
 * espalhar as tentativas por mil endereços não ajuda o atacante.
 *
 * Bloqueio temporário, não permanente: bloqueio eterno vira negação de serviço
 * contra o dono da conta — basta o atacante errar oito vezes de propósito.
 * Quinze minutos derrubam a taxa de tentativa a um patamar inútil sem entregar
 * essa arma.
 */
@Injectable()
export class AccountLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Minutos restantes de bloqueio, ou 0 se a conta está liberada. */
  async lockedMinutes(email: string): Promise<number> {
    const lock = await this.prisma.accountLock.findUnique({ where: { email } });
    if (!lock?.lockedUntil) return 0;
    const remaining = lock.lockedUntil.getTime() - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 60_000) : 0;
  }

  async registerFailure(email: string, ip: string) {
    const lock = await this.prisma.accountLock.findUnique({ where: { email } });
    const failedCount = (lock?.failedCount ?? 0) + 1;
    const shouldLock = failedCount >= MAX_FAILED;

    await this.prisma.accountLock.upsert({
      where: { email },
      create: {
        email,
        failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
      update: {
        failedCount,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });

    if (shouldLock) {
      await this.audit.record({ event: 'ACCOUNT_LOCKED', email, ip, metadata: { failedCount, lockMinutes: LOCK_MINUTES } });
    }
  }

  /** Login certo zera o contador — senão uma senha errada ontem e outra hoje
   * acabariam trancando quem só digitou errado de vez em quando. */
  async registerSuccess(email: string) {
    await this.prisma.accountLock.deleteMany({ where: { email } });
  }
}
