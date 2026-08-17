import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SelfUpdateService } from './self-update.service';

export interface PlatformWebhookState {
  enabled: boolean;
  gitRef: string;
  webhookUrl: string | null;
}

/**
 * Autoatualização por push — complementa SelfUpdateService (que já sabe
 * puxar e reconstruir, só falta quem chame).
 *
 * Antes disso, a única forma de atualizar era clicar em "Atualizar" depois de
 * uma release publicada no GitHub. Isso cobre quem quer o Velix sempre no que
 * tem de mais recente na branch, sem esperar tag nenhuma — mesmo mecanismo de
 * gatilho do autodeploy de aplicações (ver WebhooksController), mas como é
 * uma instalação só (não uma linha por implantação), a config vive numa
 * tabela de linha única (mesmo padrão de BackupSettings).
 */
@Injectable()
export class PlatformWebhookService {
  private readonly logger = new Logger(PlatformWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly selfUpdate: SelfUpdateService,
  ) {}

  private async getRow() {
    const existing = await this.prisma.platformUpdateWebhook.findUnique({ where: { id: 'default' } });
    return existing ?? this.prisma.platformUpdateWebhook.create({ data: { id: 'default' } });
  }

  async getState(): Promise<PlatformWebhookState> {
    const row = await this.getRow();
    // Mesma base de WEB_ORIGIN do autodeploy de aplicações — é por onde o
    // GitHub alcança o painel de fora, o container não sabe isso sozinho.
    const base = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
    return {
      enabled: row.enabled,
      gitRef: row.gitRef,
      webhookUrl: row.enabled && row.secret ? `${base}/api/webhooks/platform/${row.secret}` : null,
    };
  }

  async setEnabled(enabled: boolean): Promise<PlatformWebhookState> {
    const row = await this.getRow();
    const secret = row.secret ?? randomBytes(24).toString('base64url');
    await this.prisma.platformUpdateWebhook.update({ where: { id: 'default' }, data: { enabled, secret } });
    return this.getState();
  }

  /** Chamado pelo controller do webhook — sempre resolve, nunca deixa a
   * validação vazar detalhe pra fora (ver WebhooksController pro mesmo raciocínio). */
  async handlePush(secret: string, ref: string | undefined, githubEvent: string | undefined): Promise<void> {
    if (!secret || secret.length < 16) {
      this.logger.warn('Webhook de autoatualização recebido com segredo ausente ou inválido — ignorado.');
      return;
    }

    const row = await this.prisma.platformUpdateWebhook.findUnique({ where: { secret } });
    if (!row || !row.enabled) {
      this.logger.warn('Webhook de autoatualização recebido com segredo válido, mas desativado — ignorado.');
      return;
    }

    if (githubEvent === 'ping') {
      this.logger.log('Ping do GitHub recebido — webhook de autoatualização configurado corretamente.');
      return;
    }

    if (ref) {
      const pushedBranch = ref.replace(/^refs\/heads\//, '');
      if (pushedBranch !== row.gitRef) {
        this.logger.warn(`Push em "${pushedBranch}", autoatualização configurada pra "${row.gitRef}" — ignorado.`);
        return;
      }
    }

    try {
      this.selfUpdate.request('github-webhook');
      this.logger.log('Autoatualização solicitada via webhook do GitHub.');
    } catch (err) {
      // Já tem atualização em andamento, ou host não suporta self-update —
      // não é um erro do webhook em si, só não há o que fazer agora.
      this.logger.warn(`Não foi possível solicitar autoatualização via webhook: ${err instanceof Error ? err.message : err}`);
    }
  }
}
