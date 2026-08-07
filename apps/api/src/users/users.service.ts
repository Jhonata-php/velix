import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { validatePassword } from '../auth/password-policy.util';
import type { Role } from '../auth/roles.guard';

const ROLES: Role[] = ['admin', 'operator', 'viewer'];

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/**
 * Gestão de usuários — a peça que faltava para os papéis existirem de verdade.
 *
 * Sem ela, o campo `role` do JWT era decorativo: todo mundo era admin porque
 * não havia como criar alguém que não fosse.
 *
 * As duas regras que o código protege são as que transformam um painel em
 * tijolo: não deixar a instalação ficar sem nenhum administrador, e não deixar
 * alguém rebaixar ou apagar a si mesmo. As duas acontecem por engano, não por
 * má-fé, e nenhuma tem desfazer.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private toPublic(u: { id: string; name: string; email: string; role: string; createdAt: Date; totpEnabledAt: Date | null }) {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      twoFactorEnabled: !!u.totpEnabledAt,
    };
  }

  async list() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((u) => this.toPublic(u));
  }

  async create(dto: CreateUserInput) {
    const email = dto.email?.trim().toLowerCase();
    const name = dto.name?.trim();

    if (!name) throw new BadRequestException('Informe o nome');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Informe um e-mail válido');
    if (!ROLES.includes(dto.role)) throw new BadRequestException('Perfil inválido');

    // Mesma política do resto do sistema: senha fraca criada aqui seria uma
    // porta lateral para a exigência que existe na troca de senha.
    const problem = validatePassword(dto.password ?? '', email);
    if (problem) throw new BadRequestException(problem);

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new BadRequestException('Já existe um usuário com este e-mail');

    const user = await this.prisma.user.create({
      data: { name, email, role: dto.role, passwordHash: await bcrypt.hash(dto.password, 10) },
    });
    await this.audit.record({ event: 'USER_CREATED', email, metadata: { role: dto.role } });
    return this.toPublic(user);
  }

  async setRole(id: string, role: Role, actorId: string) {
    if (!ROLES.includes(role)) throw new BadRequestException('Perfil inválido');

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (id === actorId && role !== 'admin') {
      throw new ForbiddenException('Você não pode rebaixar o seu próprio perfil.');
    }
    if (user.role === 'admin' && role !== 'admin') {
      await this.assertNotLastAdmin(id);
    }

    const updated = await this.prisma.user.update({ where: { id }, data: { role } });
    await this.audit.record({ event: 'USER_ROLE_CHANGED', userId: id, email: user.email, metadata: { from: user.role, to: role } });
    return this.toPublic(updated);
  }

  async remove(id: string, actorId: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    if (id === actorId) throw new ForbiddenException('Você não pode remover a própria conta.');
    if (user.role === 'admin') await this.assertNotLastAdmin(id);

    await this.prisma.user.delete({ where: { id } });
    await this.audit.record({ event: 'USER_REMOVED', email: user.email });
    return { ok: true };
  }

  /** Sem nenhum admin, ninguém mais consegue criar usuário, mexer em servidor
   * ou atualizar — a instalação fica inutilizável sem caminho de volta pela
   * interface. */
  private async assertNotLastAdmin(excludingId: string) {
    const others = await this.prisma.user.count({ where: { role: 'admin', id: { not: excludingId } } });
    if (others === 0) {
      throw new ForbiddenException('Este é o único administrador — promova outro usuário antes.');
    }
  }
}
