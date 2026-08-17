import { Body, Controller, Headers, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GitDeployService } from './git-deploy.service';

/**
 * Recebe o aviso de push da forja e reimplanta.
 *
 * Sem JwtAuthGuard de propósito: quem chama é o GitHub, não um usuário logado.
 * A autenticação é o segredo no caminho da URL — único por implantação, gerado
 * com aleatoriedade criptográfica, e nunca reaproveitado entre implantações,
 * pra que vazar a URL de uma não permita disparar as outras.
 *
 * A resposta é sempre 202 e imediata: a forja tem timeout curto (10s no
 * GitHub) e a implantação leva minutos. Segurá-la até o fim faria o GitHub
 * marcar a entrega como falha e reenviar, disparando builds duplicados.
 */
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitDeploy: GitDeployService,
  ) {}

  @Post('git/:secret')
  @HttpCode(202)
  async onPush(
    @Param('secret') secret: string,
    @Body() payload: { ref?: string } | undefined,
    @Headers('x-github-event') githubEvent?: string,
  ) {
    // Resposta idêntica para segredo inválido e para aplicação sem autodeploy:
    // distinguir os dois transformaria este endpoint num oráculo pra descobrir
    // segredos válidos por tentativa. O log (não a resposta) é onde essa
    // distinção aparece — sem isso não tinha como saber se o GitHub sequer
    // chegou a bater aqui ou se a implantação ignorou o push por algum motivo.
    const generic = { accepted: true };

    if (!secret || secret.length < 16) {
      this.logger.warn('Webhook recebido com segredo ausente ou inválido — ignorado.');
      return generic;
    }

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { webhookSecret: secret } });
    if (!deployment || !deployment.autoDeploy || deployment.sourceType !== 'git') {
      this.logger.warn(`Webhook com segredo válido, mas implantação inexistente ou autodeploy desligado (secret=${secret.slice(0, 8)}...).`);
      return generic;
    }

    // ping é o teste que o GitHub manda ao criar o webhook — confirmar sem
    // reimplantar deixa o usuário validar a configuração sem efeito colateral.
    if (githubEvent === 'ping') {
      this.logger.log(`Ping do GitHub recebido pra implantação ${deployment.id} — webhook configurado corretamente.`);
      return generic;
    }

    // Push em outra branch não interessa: acompanhar "main" e reconstruir a
    // cada push em qualquer branch geraria implantação a cada trabalho em curso.
    // Isso é a causa mais comum de "autodeploy não funciona" — o usuário deixou
    // a branch configurada em "main" (padrão) mas o repositório usa outro nome
    // (ex.: "master") — por isso, ao contrário do resto desta rota, esse caso
    // grava uma linha no histórico de implantação em vez de sumir em silêncio:
    // o segredo já foi validado nesse ponto, então não é oráculo pra ninguém.
    if (payload?.ref && deployment.gitRef) {
      const pushedBranch = payload.ref.replace(/^refs\/heads\//, '');
      if (pushedBranch !== deployment.gitRef) {
        this.logger.warn(`Webhook ${deployment.id}: push em "${pushedBranch}", autodeploy configurado pra "${deployment.gitRef}" — ignorado.`);
        const run = await this.gitDeploy.startDeploymentRun(deployment.applicationId, { deploymentId: deployment.id, trigger: 'webhook' });
        await this.gitDeploy.finishDeploymentRun(run.id, {
          ok: false,
          error: `Push recebido na branch "${pushedBranch}", mas o autodeploy está configurado pra "${deployment.gitRef}" — nada foi implantado. Ajuste a branch em "Fonte" ou empurre pra branch configurada.`,
        });
        return generic;
      }
    }

    this.logger.log(`Webhook ${deployment.id}: disparando redeploy (branch ${deployment.gitRef ?? 'default'}).`);
    // Dispara e devolve na hora — ver o comentário da classe.
    void this.gitDeploy.redeploy(deployment.id, undefined, { trigger: 'webhook' }).catch(() => {});
    return generic;
  }
}
