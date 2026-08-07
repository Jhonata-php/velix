import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GitDeployService } from './git-deploy.service';

/**
 * Recebe o aviso de push da forja e reimplanta.
 *
 * Sem JwtAuthGuard de propósito: quem chama é o GitHub, não um usuário logado.
 * A autenticação é o segredo no caminho da URL — único por aplicação, gerado
 * com aleatoriedade criptográfica, e nunca reaproveitado entre aplicações, pra
 * que vazar a URL de uma não permita disparar as outras.
 *
 * A resposta é sempre 202 e imediata: a forja tem timeout curto (10s no
 * GitHub) e a implantação leva minutos. Segurá-la até o fim faria o GitHub
 * marcar a entrega como falha e reenviar, disparando builds duplicados.
 */
@Controller('webhooks')
export class WebhooksController {
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
    // segredos válidos por tentativa.
    const generic = { accepted: true };

    if (!secret || secret.length < 16) return generic;

    const app = await this.prisma.application.findUnique({ where: { webhookSecret: secret } });
    if (!app || !app.autoDeploy || app.sourceType !== 'git') return generic;

    // ping é o teste que o GitHub manda ao criar o webhook — confirmar sem
    // reimplantar deixa o usuário validar a configuração sem efeito colateral.
    if (githubEvent === 'ping') return generic;

    // Push em outra branch não interessa: acompanhar "main" e reconstruir a
    // cada push em qualquer branch geraria implantação a cada trabalho em curso.
    if (payload?.ref && app.gitRef) {
      const pushedBranch = payload.ref.replace(/^refs\/heads\//, '');
      if (pushedBranch !== app.gitRef) return generic;
    }

    // Dispara e devolve na hora — ver o comentário da classe.
    void this.gitDeploy.redeploy(app.id).catch(() => {});
    return generic;
  }
}
