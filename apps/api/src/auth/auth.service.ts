import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';

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
  ) {}

  async login(rawEmail: string, password: string, ip: string, userAgent: string, rememberMe = false) {
    // E-mail é normalizado (comparação case/whitespace-insensitive); a senha
    // nunca é — um espaço no fim pode ser parte intencional da senha do usuário.
    const email = rawEmail.trim().toLowerCase();
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
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

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
