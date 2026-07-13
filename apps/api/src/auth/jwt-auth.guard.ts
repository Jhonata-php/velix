import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

// ponytail: verificação direta via JwtService em vez de passport-jwt —
// uma estratégia a menos para um único método de auth (Bearer). Trocar por
// passport se precisarmos de múltiplas estratégias (OAuth, API key, etc).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token ausente');
    }
    const token = authHeader.slice('Bearer '.length);
    try {
      const payload = await this.jwt.verifyAsync(token);
      (request as any).user = payload;
      return true;
    } catch {
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
