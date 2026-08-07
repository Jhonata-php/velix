import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';
import { AccountLockService } from './account-lock.service';
import { TotpService } from './totp.service';
import { validatePassword } from './password-policy.util';

const SESSION_TTL_DEFAULT = '12h';
const SESSION_TTL_REMEMBER_ME = '30d';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly lock: AccountLockService,
    private readonly totp: TotpService,
  ) {}

  async login(rawEmail: string, password: string, ip: string, userAgent: string, rememberMe = false, totpCode?: string) {
    // E-mail é normalizado (comparação case/whitespace-insensitive); a senha
    // nunca é — um espaço no fim pode ser parte intencional da senha do usuário.
    const email = rawEmail.trim().toLowerCase();

    // Antes de conferir a senha: continuar validando numa conta travada
    // devolveria, pelo tempo de resposta, a informação de que a senha estava
    // certa — exatamente o que o bloqueio existe pra negar.
    const lockedMinutes = await this.lock.lockedMinutes(email);
    if (lockedMinutes > 0) {
      await this.audit.record({ event: 'RATE_LIMIT_BLOCKED', email, ip, userAgent, metadata: { scope: 'account-lock' } });
      throw new UnauthorizedException(
        `Muitas tentativas falhas. Tente novamente em ${lockedMinutes} minuto${lockedMinutes === 1 ? '' : 's'}.`,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

    await this.recordAttempt(email, ip, valid);
    await this.audit.record({
      event: valid ? 'LOGIN_SUCCESS' : 'LOGIN_FAILED',
      userId: user?.id,
      email,
      ip,
      userAgent,
    });

    if (!user || !valid) {
      await this.lock.registerFailure(email, ip);
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    // Segundo fator depois da senha, nunca antes: pedir o código a quem nem
    // acertou a senha revelaria que aquele e-mail existe e tem 2FA ativo.
    if (user.totpEnabledAt) {
      if (!totpCode) {
        // 'totp_required' é o que o frontend usa pra pedir o código sem tratar
        // como erro de credencial.
        throw new UnauthorizedException({ message: 'Código de verificação necessário', reason: 'totp_required' });
      }
      if (!(await this.totp.verifyForLogin(user.id, totpCode))) {
        await this.lock.registerFailure(email, ip);
        throw new UnauthorizedException({ message: 'Código de verificação inválido', reason: 'totp_invalid' });
      }
    }

    await this.lock.registerSuccess(email);

    const session = await this.sessions.create(user.id, ip, userAgent);
    const expiresIn = rememberMe ? SESSION_TTL_REMEMBER_ME : SESSION_TTL_DEFAULT;
    const token = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role, sid: session.id }, { expiresIn });

    return {
      accessToken: token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Sua sessão expirou. Entre novamente.');
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }

  async logout(sessionId: string, userId: string, ip: string, userAgent: string) {
    await this.sessions.revoke(sessionId, userId);
    await this.audit.record({ event: 'LOGOUT', userId, ip, userAgent });
  }

  async logoutAll(userId: string, ip: string, userAgent: string) {
    await this.sessions.revokeAllForUser(userId);
    await this.audit.record({ event: 'LOGOUT_ALL', userId, ip, userAgent });
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.sessions.listActive(userId);
    return sessions.map((s) => ({
      id: s.id,
      ip: s.ip,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      current: s.id === currentSessionId,
    }));
  }

  async revokeSession(sessionId: string, userId: string, ip: string, userAgent: string) {
    await this.sessions.revoke(sessionId, userId);
    await this.audit.record({ event: 'SESSION_REVOKED', userId, ip, userAgent, metadata: { sessionId } });
  }

  /** "Encerrar todas as outras sessões" — mantém a sessão atual viva (diferente de logoutAll). */
  async revokeOtherSessions(userId: string, currentSessionId: string, ip: string, userAgent: string) {
    await this.sessions.revokeAllForUser(userId, currentSessionId);
    await this.audit.record({ event: 'LOGOUT_ALL', userId, ip, userAgent, metadata: { keptCurrentSession: true } });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionId: string, ip: string, userAgent: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Sua sessão expirou. Entre novamente.');

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException('Senha atual incorreta.');

    const policyError = validatePassword(newPassword, user.email);
    if (policyError) throw new BadRequestException(policyError);

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

    // Mantém a sessão atual (o usuário continua logado onde acabou de trocar
    // a senha), mas derruba qualquer outro dispositivo/sessão esquecido.
    await this.sessions.revokeAllForUser(userId, currentSessionId);
    await this.audit.record({ event: 'PASSWORD_CHANGED', userId, ip, userAgent });
  }

  private async recordAttempt(email: string, ip: string, success: boolean) {
    this.logger.log(`login ${success ? 'sucesso' : 'falha'} email=${email} ip=${ip}`);
    try {
      await this.prisma.loginAttempt.create({ data: { email, ip, success } });
    } catch (err) {
      // Falha ao gravar auditoria não pode derrubar o login em si.
      this.logger.warn(`não foi possível gravar tentativa de login: ${err instanceof Error ? err.message : err}`);
    }
  }
}
