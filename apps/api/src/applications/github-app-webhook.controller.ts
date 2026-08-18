import { Controller, Headers, HttpCode, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubAppService } from '../git-accounts/github-app.service';
import { verifyWebhookSignature } from '../git-accounts/github-app.util';
import { GitDeployService } from './git-deploy.service';
import { parseGitHubOwnerRepo } from './git-source.util';

interface GitHubAppEventPayload {
  installation?: { id?: number };
  repository?: { full_name?: string };
  ref?: string;
}

/**
 * Webhook central de uma instalação de GitHub App — diferente do webhook
 * clássico por repositório (ver WebhooksController), essa é UMA URL só,
 * compartilhada por todas as contas conectadas via "Conectar com GitHub",
 * entregando eventos de TODOS os repositórios de cada instalação (ver
 * github-app.util.ts: hook_attributes). GitHub Apps não conseguem criar
 * webhook por repositório via API — só esse mecanismo funciona pra elas.
 *
 * A instalação de origem vem do `installation.id` no corpo do evento; a
 * assinatura HMAC (segredo que o próprio GitHub gera na criação do App) é o
 * que garante que o evento é legítimo pra essa instalação específica, não
 * uma tentativa de disparar redeploy alheio sabendo só o id.
 *
 * Sem JwtAuthGuard de propósito — mesmo raciocínio de WebhooksController:
 * quem chama é o GitHub, não uma sessão de usuário.
 */
@Controller('webhooks')
export class GitHubAppWebhookController {
  private readonly logger = new Logger(GitHubAppWebhookController.name);

  constructor(
    private readonly githubApp: GitHubAppService,
    private readonly prisma: PrismaService,
    private readonly gitDeploy: GitDeployService,
  ) {}

  @Post('github-app')
  @HttpCode(202)
  async onEvent(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-github-event') githubEvent?: string,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const generic = { accepted: true };
    const raw = req.rawBody;
    if (!raw) return generic;

    let payload: GitHubAppEventPayload;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      this.logger.warn('Webhook do GitHub App recebido com corpo inválido — ignorado.');
      return generic;
    }

    // Evento de app_manifest/ping antes de qualquer instalação existir não
    // tem installation nenhuma — nada pra verificar, só confirma que a URL
    // responde (é o que o GitHub testa ao salvar o webhook do App).
    const installationId = payload.installation?.id ? String(payload.installation.id) : null;
    if (!installationId) return generic;

    const account = await this.githubApp.findAccountByInstallation(installationId);
    if (!account) {
      this.logger.warn(`Webhook do GitHub App recebido pra instalação desconhecida (${installationId}) — ignorado.`);
      return generic;
    }

    const webhookSecret = await this.githubApp.resolveWebhookSecret(account);
    if (!webhookSecret || !verifyWebhookSignature(raw, signature, webhookSecret)) {
      this.logger.warn(`Webhook do GitHub App recebido com assinatura inválida (instalação ${installationId}) — ignorado.`);
      return generic;
    }

    if (githubEvent === 'ping') {
      this.logger.log(`Ping do GitHub App recebido pra instalação ${installationId} — webhook configurado corretamente.`);
      return generic;
    }
    if (githubEvent !== 'push') return generic;

    const repoFullName = payload.repository?.full_name;
    const branch = payload.ref?.replace(/^refs\/heads\//, '');
    if (!repoFullName || !branch) return generic;

    const deployments = await this.prisma.projectDeployment.findMany({
      where: { gitAccountId: account.id, autoDeploy: true, sourceType: 'git' },
    });

    const matching = deployments.filter((deployment) => {
      if (!deployment.repoUrl) return false;
      const parsed = parseGitHubOwnerRepo(deployment.repoUrl);
      if (!parsed) return false;
      const sameRepo = `${parsed.owner}/${parsed.repo}`.toLowerCase() === repoFullName.toLowerCase();
      return sameRepo && (!deployment.gitRef || deployment.gitRef === branch);
    });

    for (const deployment of matching) {
      this.logger.log(`Webhook do GitHub App: disparando redeploy de ${deployment.id} (${repoFullName}@${branch}).`);
      void this.gitDeploy.redeploy(deployment.id, undefined, { trigger: 'webhook' }).catch(() => {});
    }

    return generic;
  }
}
