import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { ServerWatcher } from './server-watcher';
import { ThresholdAlertService } from './threshold-alert.service';

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  private readonly watchers = new Map<string, ServerWatcher>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
    private readonly evaluator: ThresholdAlertService,
  ) {}

  async onModuleInit() {
    try {
      await this.reconcile();
    } catch (err) {
      // Não derruba o boot da API por uma falha pontual na primeira
      // reconciliação (ex.: banco ainda subindo) — o próprio @Cron tenta de
      // novo no minuto seguinte.
      this.logger.warn(`reconciliação inicial falhou: ${err instanceof Error ? err.message : err}`);
    }
  }

  onModuleDestroy() {
    for (const watcher of this.watchers.values()) watcher.stop();
  }

  /**
   * Compara servidores cadastrados com watchers rodando e ajusta — cobre
   * servidor criado/removido sem precisar acoplar ServersService a este
   * módulo. Roda a cada minuto: novo servidor cadastrado leva até 1min pra
   * começar a ser monitorado, o que é aceitável (o cadastro em si não é uma
   * operação de alta frequência).
   */
  @Cron('*/1 * * * *')
  async reconcile() {
    const servers = await this.prisma.server.findMany({ select: { id: true } });
    const currentIds = new Set(servers.map((s) => s.id));

    for (const [id, watcher] of this.watchers) {
      if (!currentIds.has(id)) {
        watcher.stop();
        this.watchers.delete(id);
      }
    }

    for (const id of currentIds) {
      if (this.watchers.has(id)) continue;
      try {
        const { options } = await this.servers.getServerWithConnectOptions(id);
        const watcher = new ServerWatcher(
          id,
          options,
          this.ssh,
          (sample) => void this.evaluator.handleSample(id, sample).catch((err) => this.logger.warn(`amostra de ${id}: ${err}`)),
          (event) => void this.evaluator.handleDockerEvent(id, event).catch((err) => this.logger.warn(`evento de ${id}: ${err}`)),
        );
        watcher.start();
        this.watchers.set(id, watcher);
      } catch (err) {
        this.logger.warn(`Não foi possível iniciar monitoramento de ${id}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}
