import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { SessionService } from './session.service';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
  sid?: string;
}

// ponytail: verificação direta via JwtService em vez de passport-jwt —
// uma estratégia a menos para um único método de auth (Bearer). Trocar por
// passport se precisarmos de múltiplas estratégias (OAuth, API key, etc).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    const token = authHeader.slice('Bearer '.length);

    let payload: AuthenticatedUser;
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }

    // JWTs emitidos antes desta mudança não têm `sid` — tratados como válidos
    // até expirarem naturalmente (não dá pra revogar o que não tem id de sessão).
    if (payload.sid) {
      const active = await this.sessions.isActive(payload.sid);
      if (!active) {
        throw new UnauthorizedException('Sua sessão foi encerrada. Entre novamente.');
      }
      this.sessions.touchLastSeen(payload.sid);
    }

    (request as Request & { user: AuthenticatedUser }).user = payload;
    return true;
  }
}
