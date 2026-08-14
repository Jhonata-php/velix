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

  async getForServer(userId: string, serverId: string) {
    return this.prisma.alertThresholdPreference.findFirst({ where: { userId, serverId } });
  }

  async updateForServer(userId: string, serverId: string, dto: UpdateThresholdDto) {
    const existing = await this.getForServer(userId, serverId);
    if (existing) {
      return this.prisma.alertThresholdPreference.update({ where: { id: existing.id }, data: dto });
    }
    return this.prisma.alertThresholdPreference.create({ data: { userId, serverId, ...dto } });
  }
}
