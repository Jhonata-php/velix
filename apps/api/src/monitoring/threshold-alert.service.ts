import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { resolveThresholdsForServer, ThresholdPreferenceRow } from './threshold-resolver.util';
import { computeCpuPercent, computeMemoryPercent, RawSample } from './metrics-sample.util';
import { NormalizedDockerEvent } from './docker-event.util';

type MetricKey = 'cpu' | 'memory' | 'temperature';

/**
 * Recebe as amostras/eventos que o ServerWatcher produz, resolve o limite de
 * cada usuário interessado naquele servidor e decide se dispara push — abre
 * quando cruza o limite, lembra a cada 15min enquanto continuar ativo,
 * resolve quando volta ao normal (mesma ideia do AlertState de
 * alerts.service.ts, mas por usuário em vez de global).
 * Eventos de container são discretos (o próprio `docker events` só emite
 * cada um uma vez) — não passam pelo padrão abre/resolve, disparam direto.
 */
@Injectable()
export class ThresholdAlertService {
  private readonly logger = new Logger(ThresholdAlertService.name);
  private readonly lastRawSample = new Map<string, RawSample>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  async handleSample(serverId: string, sample: RawSample) {
    const prev = this.lastRawSample.get(serverId) ?? null;
    this.lastRawSample.set(serverId, sample);

    const cpuPercent = computeCpuPercent(prev, sample);
    const memoryPercent = computeMemoryPercent(sample);
    const temperatureCelsius = sample.temperatureCelsius;

    const resolved = resolveThresholdsForServer(await this.loadPreferences(serverId), serverId);

    for (const pref of resolved) {
      if (cpuPercent !== null && pref.cpuPercent !== null) {
        await this.evaluate('cpu', serverId, pref.userId, cpuPercent >= pref.cpuPercent, {
          title: 'CPU alta',
          body: `CPU em ${cpuPercent}%, acima do limite de ${pref.cpuPercent}%.`,
        });
      }
      if (memoryPercent !== null && pref.memoryPercent !== null) {
        await this.evaluate('memory', serverId, pref.userId, memoryPercent >= pref.memoryPercent, {
          title: 'Memória alta',
          body: `Memória em ${memoryPercent}%, acima do limite de ${pref.memoryPercent}%.`,
        });
      }
      if (temperatureCelsius !== null && pref.temperatureCelsius !== null) {
        await this.evaluate('temperature', serverId, pref.userId, temperatureCelsius >= pref.temperatureCelsius, {
          title: 'Temperatura alta',
          body: `Temperatura em ${temperatureCelsius}°C, acima do limite de ${pref.temperatureCelsius}°C.`,
        });
      }
    }
  }

  async handleDockerEvent(serverId: string, event: NormalizedDockerEvent) {
    const resolved = resolveThresholdsForServer(await this.loadPreferences(serverId), serverId);

    for (const pref of resolved) {
      if (!pref.dockerEnabled) continue;

      if (pref.dockerScope === 'managed_apps') {
        const managed = await this.prisma.application.findFirst({
          where: { serverId, containerNames: { has: event.containerName } },
          select: { id: true },
        });
        if (!managed) continue;
      }

      const verb = event.kind === 'restarted' ? 'reiniciou' : event.kind === 'crashed' ? 'travou' : 'parou';
      await this.push
        .sendToUser(pref.userId, {
          title: `Container ${verb}`,
          body: `${event.containerName} ${verb}${event.exitCode !== null ? ` (código ${event.exitCode})` : ''}.`,
          data: { serverId, containerId: event.containerId },
        })
        .catch((err) => this.logger.warn(`push de evento docker falhou: ${err instanceof Error ? err.message : err}`));
    }
  }

  private async loadPreferences(serverId: string): Promise<ThresholdPreferenceRow[]> {
    // ponytail: consulta o banco a cada amostra (a cada 5s por servidor) em
    // vez de cachear em memória — número de servidores/usuários de uma
    // instalação Velix é pequeno o bastante pra isso não pesar. Cachear com
    // invalidação quando a preferência muda vira necessário só se a escala
    // da instalação crescer muito.
    return this.prisma.alertThresholdPreference.findMany({ where: { OR: [{ serverId }, { serverId: null }] } });
  }

  /** Enquanto a condição continuar ativa sem se resolver, reenvia um lembrete
   * a cada 15min — sem isso, quem recebeu o alerta às 3h não tem como saber
   * se ainda está de pé sem abrir o app. `AlertState.lastSeenAt` (já existe,
   * `@updatedAt`) guarda quando foi o último envio: só é tocado quando este
   * método realmente manda um push (abertura ou lembrete), nunca nos ticks
   * em que nada acontece — é isso que faz o intervalo de 15min valer. */
  private static readonly REMINDER_INTERVAL_MS = 15 * 60 * 1000;

  private async evaluate(
    metric: MetricKey,
    serverId: string,
    userId: string,
    isActive: boolean,
    content: { title: string; body: string },
  ) {
    const fingerprint = `${metric}-high:${serverId}:${userId}`;
    const state = await this.prisma.alertState.findUnique({ where: { fingerprint } });

    if (isActive && !state) {
      await this.prisma.alertState.create({ data: { fingerprint } });
      await this.push
        .sendToUser(userId, { title: content.title, body: content.body, data: { serverId, metric } })
        .catch((err) => this.logger.warn(`push de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
      return;
    }

    if (isActive && state) {
      const elapsed = Date.now() - state.lastSeenAt.getTime();
      if (elapsed < ThresholdAlertService.REMINDER_INTERVAL_MS) return;
      await this.prisma.alertState.update({ where: { fingerprint }, data: {} }); // bump lastSeenAt (@updatedAt)
      await this.push
        .sendToUser(userId, { title: content.title, body: content.body, data: { serverId, metric } })
        .catch((err) => this.logger.warn(`lembrete de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
      return;
    }

    if (!isActive && state) {
      await this.prisma.alertState.delete({ where: { fingerprint } });
      await this.push
        .sendToUser(userId, {
          title: `${content.title}: normalizado`,
          body: `Voltou ao normal em ${new Date().toLocaleString('pt-BR')}.`,
          data: { serverId, metric },
        })
        .catch((err) => this.logger.warn(`push de resolução de ${metric} falhou: ${err instanceof Error ? err.message : err}`));
    }
  }
}
