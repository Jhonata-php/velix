import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionService {
  // Throttle de escrita de "última atividade": o painel faz polling (status,
  // métricas) a cada ~10s em várias telas, então atualizar lastSeenAt a cada
  // requisição autenticada seria um UPDATE constante sem ganho real.
  private readonly lastSeenCache = new Map<string, number>();
  private static readonly LAST_SEEN_THROTTLE_MS = 5 * 60_000;

  constructor(private readonly prisma: PrismaService) {}

  create(userId: string, ip: string | null, userAgent: string | null) {
    return this.prisma.userSession.create({ data: { userId, ip, userAgent } });
  }

  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.userSession.findUnique({ where: { id: sessionId } });
    return !!session && !session.revokedAt;
  }

  /** Fire-and-forget, throttlado — nunca atrasa a resposta da requisição por causa disso. */
  touchLastSeen(sessionId: string) {
    const now = Date.now();
    const last = this.lastSeenCache.get(sessionId) ?? 0;
    if (now - last < SessionService.LAST_SEEN_THROTTLE_MS) return;
    this.lastSeenCache.set(sessionId, now);
    this.prisma.userSession.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }

  async revoke(sessionId: string, userId: string) {
    await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { NOT: { id: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  listActive(userId: string) {
    return this.prisma.userSession.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
    });
  }
}
