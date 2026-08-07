import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type AuditEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'PASSWORD_RECOVERY_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_CHANGED'
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'SESSION_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'RATE_LIMIT_BLOCKED'
  | 'TOTP_ENABLED'
  | 'TOTP_DISABLED'
  | 'TOTP_RECOVERY_USED'
  | 'ACCOUNT_LOCKED'
  | 'USER_CREATED'
  | 'USER_ROLE_CHANGED'
  | 'USER_REMOVED';

interface RecordInput {
  event: AuditEvent;
  userId?: string | null;
  email?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

// Nunca passar senha, hash, token bruto, cookie ou Authorization em
// `metadata` — este serviço grava tudo que recebe, a responsabilidade de
// nunca colocar dado sensível aqui é de quem chama.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordInput) {
    try {
      await this.prisma.auditLog.create({
        data: {
          event: input.event,
          userId: input.userId ?? null,
          email: input.email ?? null,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          metadata: (input.metadata ?? undefined) as never,
        },
      });
    } catch (err) {
      // Falha ao gravar auditoria nunca pode derrubar o fluxo principal.
      this.logger.warn(`falha ao gravar auditoria (${input.event}): ${err instanceof Error ? err.message : err}`);
    }
  }
}
