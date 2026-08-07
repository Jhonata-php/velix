import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthenticatedUser } from './jwt-auth.guard';

export type Role = 'admin' | 'operator' | 'viewer';

/**
 * Hierarquia, não lista de papéis por rota.
 *
 * Com lista, marcar uma rota com `@Roles('operator')` esqueceria o admin — e o
 * erro só apareceria quando alguém tentasse usar. Aqui cada papel vale o
 * próprio nível e todos abaixo, então declarar o mínimo necessário basta.
 */
const LEVEL: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };

export const ROLES_KEY = 'velix:minRole';

/** Papel mínimo exigido. Sem o decorator, qualquer usuário autenticado passa. */
export const MinRole = (role: Role) => SetMetadata(ROLES_KEY, role);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const role = (request.user?.role ?? 'viewer') as Role;

    // Papel desconhecido cai no mais baixo em vez de passar: um valor errado no
    // banco (ou um papel removido numa versão futura) não pode virar acesso
    // total por acidente.
    const current = LEVEL[role] ?? LEVEL.viewer;
    if (current >= LEVEL[required]) return true;

    throw new ForbiddenException(
      required === 'admin'
        ? 'Apenas administradores podem executar esta ação.'
        : 'Seu perfil não permite executar esta ação.',
    );
  }
}
