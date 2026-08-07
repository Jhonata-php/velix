/**
 * Self-check da hierarquia de papéis — sem framework:
 *   npx ts-node src/auth/roles.guard.spec.ts
 */
import assert from 'node:assert';
import { ForbiddenException } from '@nestjs/common';
import { RolesGuard, type Role } from './roles.guard';

/** Reflector falso: devolve sempre o papel mínimo que o teste quer exercitar. */
function guardFor(required: Role | undefined) {
  const reflector = { getAllAndOverride: () => required } as never;
  return new RolesGuard(reflector);
}

function contextWith(role: string | undefined) {
  return {
    getHandler: () => null,
    getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as never;
}

function allows(required: Role | undefined, role: string | undefined) {
  try {
    return guardFor(required).canActivate(contextWith(role));
  } catch (err) {
    if (err instanceof ForbiddenException) return false;
    throw err;
  }
}

// Sem decorator, qualquer autenticado passa — é o comportamento das rotas de leitura.
assert.equal(allows(undefined, 'viewer'), true);
assert.equal(allows(undefined, undefined), true);

// Cada papel vale o próprio nível e todos abaixo.
assert.equal(allows('viewer', 'viewer'), true);
assert.equal(allows('viewer', 'operator'), true);
assert.equal(allows('viewer', 'admin'), true);

assert.equal(allows('operator', 'viewer'), false);
assert.equal(allows('operator', 'operator'), true);
assert.equal(allows('operator', 'admin'), true);

assert.equal(allows('admin', 'viewer'), false);
assert.equal(allows('admin', 'operator'), false);
assert.equal(allows('admin', 'admin'), true);

// Papel desconhecido ou ausente cai no mais baixo, nunca no mais alto: um valor
// errado no banco não pode virar acesso total por acidente.
assert.equal(allows('operator', 'superuser'), false);
assert.equal(allows('operator', ''), false);
assert.equal(allows('admin', undefined), false);
assert.equal(allows('viewer', 'superuser'), true, 'papel desconhecido deve valer como viewer, não menos');

console.log('roles.guard self-check OK');
