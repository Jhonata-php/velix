import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PasswordResetMailService } from '../mail/password-reset-mail.service';
import { PasswordResetTokenService, TokenValidation } from './password-reset-token.service';
import { SessionService } from './session.service';
import { validatePassword } from './password-policy.util';

// No máximo 3 pedidos de recuperação por e-mail a cada 15min — o limite por
// IP já existe via @Throttle no controller; este aqui é por e-mail porque um
// atacante pode trocar de IP mas não do e-mail-alvo. O bloqueio é silencioso
// (mesma resposta neutra) pra não revelar que existe um limite sendo aplicado.
const MAX_REQUESTS_PER_EMAIL_WINDOW = 3;
const EMAIL_WINDOW_MS = 15 * 60_000;

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: PasswordResetTokenService,
    private readonly mail: PasswordResetMailService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
  ) {}

  /** Sempre "tem sucesso" do ponto de vista do chamador — nunca revela se o e-mail existe. */
  async forgotPassword(email: string, ip: string, userAgent: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.audit.record({ event: 'PASSWORD_RECOVERY_REQUESTED', email, ip, userAgent, metadata: { userExists: false } });
      return;
    }

    const recentCount = await this.prisma.auditLog.count({
      where: {
        event: 'PASSWORD_RECOVERY_REQUESTED',
        email,
        createdAt: { gt: new Date(Date.now() - EMAIL_WINDOW_MS) },
      },
    });

    if (recentCount >= MAX_REQUESTS_PER_EMAIL_WINDOW) {
      await this.audit.record({ event: 'RATE_LIMIT_BLOCKED', userId: user.id, email, ip, userAgent, metadata: { scope: 'forgot-password' } });
      return;
    }

    const { rawToken, expiresAt } = await this.tokens.issue(user.id, ip, userAgent);
    const publicUrl = (process.env.VELIX_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
    const resetUrl = `${publicUrl}/reset-password?token=${rawToken}`;

    const result = await this.mail.send({ to: user.email, userName: user.name, resetUrl, expiresInMinutes: this.tokens.ttlMinutes });
    if (!result.delivered) {
      this.logger.warn(`e-mail de recuperação não entregue pra ${user.email}: ${result.reason}`);
    }

    await this.audit.record({
      event: 'PASSWORD_RECOVERY_REQUESTED',
      userId: user.id,
      email,
      ip,
      userAgent,
      metadata: { delivered: result.delivered, expiresAt: expiresAt.toISOString() },
    });
  }

  validateToken(rawToken: string): Promise<TokenValidation> {
    return this.tokens.validate(rawToken);
  }

  async resetPassword(rawToken: string, newPassword: string, ip: string, userAgent: string): Promise<{ email: string }> {
    const validation = await this.tokens.validate(rawToken);
    if (!validation.valid) {
      throw new BadRequestException(messageForInvalidReason(validation.reason));
    }

    const user = await this.prisma.user.findUnique({ where: { id: validation.userId } });
    if (!user) throw new BadRequestException('Link de redefinição inválido.');

    const policyError = validatePassword(newPassword, user.email);
    if (policyError) throw new BadRequestException(policyError);

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    await this.tokens.consume(validation.tokenId);
    // Redefinir a senha derruba todas as sessões existentes — um token
    // vazado ou uma sessão esquecida em outro dispositivo param de valer.
    await this.sessions.revokeAllForUser(user.id);

    await this.audit.record({ event: 'PASSWORD_RESET_COMPLETED', userId: user.id, email: user.email, ip, userAgent });

    return { email: user.email };
  }
}

function messageForInvalidReason(reason: 'not_found' | 'expired' | 'used'): string {
  if (reason === 'expired') return 'Este link expirou. Solicite uma nova recuperação de senha.';
  if (reason === 'used') return 'Este link já foi utilizado. Solicite uma nova recuperação de senha, se necessário.';
  return 'Link de redefinição inválido.';
}
