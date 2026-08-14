import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateThresholdDto } from './dto/update-threshold.dto';

@Injectable()
export class AlertThresholdsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGlobal(userId: string) {
    return this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId: null } });
  }

  async updateGlobal(userId: string, dto: UpdateThresholdDto) {
    const existing = await this.getGlobal(userId);
    if (existing) {
      return this.prisma.alertThresholdPreference.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.alertThresholdPreference.create({ data: { userId, serverId: null, ...dto } });
  }

  /** Override específico do servidor, ou o global do usuário se não houver
   * override — contrato do endpoint GET (ver design spec, seção de
   * endpoints). Sem o fallback, o app mostraria "não configurado" mesmo
   * quando um limite global já está em vigor. */
  async getForServer(userId: string, serverId: string) {
    const perServer = await this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId } });
    return perServer ?? (await this.getGlobal(userId));
  }

  async updateForServer(userId: string, serverId: string, dto: UpdateThresholdDto) {
    // Não usa getForServer aqui de propósito: aquele método cai pro global
    // quando não há override, e um update precisa criar/atualizar o
    // override do servidor mesmo assim — nunca tocar a linha global.
    const existing = await this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId } });
    if (existing) {
      return this.prisma.alertThresholdPreference.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.alertThresholdPreference.create({ data: { userId, serverId, ...dto } });
  }
}
