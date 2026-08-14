import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';

export type ChannelType = 'discord' | 'telegram' | 'webhook';

export interface CreateChannelInput {
  label: string;
  type: ChannelType;
  /** discord/webhook: { url }. telegram: { botToken, chatId }. */
  config: Record<string, string>;
}

interface Condition {
  fingerprint: string;
  title: string;
  body: string;
}

const DELIVERY_TIMEOUT_MS = 10_000;

/**
 * Alertas de infraestrutura.
 *
 * O ponto que decide se um sistema de alerta é útil ou vira ruído é o
 * reenvio. Uma checagem a cada 5 minutos que dispara toda vez que a condição
 * segue verdadeira mandaria "disco cheio" 288 vezes por dia — e a partir do
 * terceiro dia ninguém lê mais o canal, inclusive quando chega algo novo.
 *
 * Por isso o estado de cada condição é guardado: avisa quando abre, avisa de
 * novo só quando fecha, e nada no meio. O "voltou ao normal" não é enfeite —
 * sem ele, quem recebeu o alerta às 3h não tem como saber se ainda está de pé
 * sem abrir o painel.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---- canais ----

  private toPublic(c: { id: string; label: string; type: string; enabled: boolean; createdAt: Date }) {
    return { id: c.id, label: c.label, type: c.type, enabled: c.enabled, createdAt: c.createdAt };
  }

  async listChannels() {
    const channels = await this.prisma.alertChannel.findMany({ orderBy: { createdAt: 'desc' } });
    const recent = await this.prisma.alertDelivery.findMany({ orderBy: { sentAt: 'desc' }, take: 20 });
    return { channels: channels.map((c) => this.toPublic(c)), recent };
  }

  async createChannel(dto: CreateChannelInput) {
    const label = dto.label?.trim();
    if (!label) throw new BadRequestException('Dê um nome para o destino');

    if (dto.type === 'discord' || dto.type === 'webhook') {
      const url = dto.config?.url?.trim();
      // Só https: um webhook em http mandaria o conteúdo do alerta — nomes de
      // servidor, endereços — em texto puro pela rede.
      if (!url || !/^https:\/\//.test(url)) throw new BadRequestException('Informe uma URL https válida');
    } else if (dto.type === 'telegram') {
      if (!dto.config?.botToken?.trim() || !dto.config?.chatId?.trim()) {
        throw new BadRequestException('Informe o token do bot e o chat ID');
      }
    } else {
      throw new BadRequestException('Tipo de destino inválido');
    }

    const channel = await this.prisma.alertChannel.create({
      data: { label, type: dto.type, configEnc: encryptCredential(JSON.stringify(dto.config)) },
    });
    return this.toPublic(channel);
  }

  async removeChannel(id: string) {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Destino não encontrado');
    await this.prisma.alertChannel.delete({ where: { id } });
    return { ok: true };
  }

  async testChannel(id: string) {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Destino não encontrado');
    return this.deliver(channel, {
      fingerprint: `test:${id}`,
      title: 'Teste do Velix',
      body: 'Se você está lendo isto, os alertas estão configurados corretamente.',
    });
  }

  // ---- envio ----

  private async deliver(
    channel: { id: string; type: string; configEnc: string },
    condition: Condition,
  ): Promise<{ ok: boolean; error?: string }> {
    const config = JSON.parse(decryptCredential(channel.configEnc)) as Record<string, string>;
    const text = `**${condition.title}**\n${condition.body}`;

    let url: string;
    let payload: unknown;

    if (channel.type === 'discord') {
      url = config.url;
      payload = { content: text };
    } else if (channel.type === 'telegram') {
      url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      payload = { chat_id: config.chatId, text, parse_mode: 'Markdown' };
    } else {
      url = config.url;
      payload = { title: condition.title, body: condition.body, source: 'velix' };
    }

    try {
      // Timeout curto: o laço de checagem roda a cada 5 minutos, e um destino
      // pendurado não pode segurar os demais.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const ok = res.ok;
      await this.prisma.alertDelivery.create({
        data: {
          channelId: channel.id,
          fingerprint: condition.fingerprint,
          title: condition.title,
          body: condition.body,
          ok,
          error: ok ? null : `HTTP ${res.status}`,
        },
      });
      return ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar';
      await this.prisma.alertDelivery.create({
        data: { channelId: channel.id, fingerprint: condition.fingerprint, title: condition.title, body: condition.body, ok: false, error: message.slice(0, 300) },
      });
      return { ok: false, error: message };
    }
  }

  private async broadcast(condition: Condition) {
    const channels = await this.prisma.alertChannel.findMany({ where: { enabled: true } });
    for (const channel of channels) {
      await this.deliver(channel, condition);
    }
  }

  // ---- checagem ----

  /**
   * A cada 5 minutos. Não menos: as métricas dos servidores são coletadas por
   * polling do próprio painel, então checar mais rápido só olharia os mesmos
   * números de novo.
   */
  @Cron('*/5 * * * *')
  async check() {
    const channels = await this.prisma.alertChannel.count({ where: { enabled: true } });
    if (channels === 0) return; // sem destino, nem vale consultar o banco

    const conditions = await this.collectConditions();
    const active = new Set(conditions.map((c) => c.fingerprint));
    // AlertState é uma tabela compartilhada: o ThresholdAlertService
    // (apps/api/src/monitoring/threshold-alert.service.ts) também guarda
    // estado nela, por usuário, com fingerprints "cpu-high:", "memory-high:"
    // e "temperature-high:". Sem este filtro, collectConditions() (que não
    // sabe dessas fingerprints) trataria toda linha delas como "resolvida" a
    // cada 5 minutos, apagando o estado do outro serviço e vazando a
    // fingerprint crua num "voltou ao normal" pros canais de Discord/
    // Telegram/webhook.
    const known = (
      await this.prisma.alertState.findMany()
    ).filter(
      (k) => !k.fingerprint.startsWith('cpu-high:') && !k.fingerprint.startsWith('memory-high:') && !k.fingerprint.startsWith('temperature-high:'),
    );
    const knownSet = new Set(known.map((k) => k.fingerprint));

    // Abriu agora
    for (const condition of conditions) {
      if (knownSet.has(condition.fingerprint)) continue;
      await this.prisma.alertState.create({ data: { fingerprint: condition.fingerprint } });
      await this.broadcast(condition);
    }

    // Fechou
    for (const state of known) {
      if (active.has(state.fingerprint)) continue;
      await this.prisma.alertState.delete({ where: { fingerprint: state.fingerprint } });
      await this.broadcast({
        fingerprint: state.fingerprint,
        title: 'Resolvido',
        body: `A condição "${state.fingerprint}" voltou ao normal.`,
      });
    }
  }

  /** O que está errado agora. Cada item vira (ou deixa de ser) um alerta. */
  private async collectConditions(): Promise<Condition[]> {
    const found: Condition[] = [];

    const servers = await this.prisma.server.findMany();
    for (const server of servers) {
      if (server.status === 'ERROR' || server.status === 'OFFLINE') {
        found.push({
          fingerprint: `server-offline:${server.id}`,
          title: `Servidor fora do ar: ${server.name}`,
          body: `O Velix não consegue se conectar em ${server.publicIp ?? server.hostname ?? server.name}.`,
        });
      }

      const metrics = server.metrics as { diskPercent?: string; memUsedMb?: number; memTotalMb?: number } | null;
      const disk = Number((metrics?.diskPercent ?? '').replace('%', ''));
      if (Number.isFinite(disk) && disk >= 90) {
        found.push({
          fingerprint: `disk-full:${server.id}`,
          title: `Disco quase cheio: ${server.name}`,
          body: `Uso em ${disk}%. Acima de 90% o Docker começa a falhar em builds e gravação de logs.`,
        });
      }
    }

    const brokenApps = await this.prisma.application.findMany({
      where: { status: 'ERROR' },
      include: { server: { select: { name: true } } },
    });
    for (const app of brokenApps) {
      found.push({
        fingerprint: `app-error:${app.id}`,
        title: `Aplicação com erro: ${app.name}`,
        body: `Em ${app.server.name}. ${app.lastError ?? 'Sem detalhe registrado.'}`,
      });
    }

    // Backup é o alerta que mais importa e o que menos se percebe sozinho:
    // ninguém abre a tela de backup todo dia pra conferir.
    const lastGood = await this.prisma.backupRun.findFirst({
      where: { status: 'SUCCESS' },
      orderBy: { startedAt: 'desc' },
    });
    const hasAnyRun = await this.prisma.backupRun.count();
    if (hasAnyRun > 0 && (!lastGood || Date.now() - lastGood.startedAt.getTime() > 2 * 86400_000)) {
      found.push({
        fingerprint: 'backup-stale',
        title: 'Backup sem sucesso há mais de 2 dias',
        body: lastGood
          ? `O último backup concluído foi em ${lastGood.startedAt.toLocaleString('pt-BR')}.`
          : 'Nenhum backup foi concluído com sucesso ainda.',
      });
    }

    return found;
  }
}
