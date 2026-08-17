import { Body, Controller, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { PlatformWebhookService } from './platform-webhook.service';

/**
 * Recebe o aviso de push do GitHub pro repositório do próprio Velix.
 *
 * Sem JwtAuthGuard de propósito: quem chama é o GitHub, não um usuário
 * logado — mesmo raciocínio de WebhooksController (autodeploy de
 * aplicações). A resposta é sempre 202 e idêntica independente do segredo
 * ser válido, pra não virar oráculo de segredo por tentativa; a distinção
 * fica só no log (ver PlatformWebhookService.handlePush).
 */
@Controller('webhooks')
export class PlatformWebhookController {
  constructor(private readonly platformWebhook: PlatformWebhookService) {}

  @Post('platform/:secret')
  @HttpCode(202)
  async onPush(
    @Param('secret') secret: string,
    @Body() payload: { ref?: string } | undefined,
    @Headers('x-github-event') githubEvent?: string,
  ) {
    // Dispara e devolve na hora — o GitHub tem timeout curto (10s) e o
    // self-update é só um pedido gravado em disco, mas mesmo assim não vale
    // a pena segurar a resposta por causa dele.
    void this.platformWebhook.handlePush(secret, payload?.ref, githubEvent).catch(() => {});
    return { accepted: true };
  }
}
