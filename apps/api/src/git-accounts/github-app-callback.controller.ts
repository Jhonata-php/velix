import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GitHubAppService } from './github-app.service';

/**
 * Etapas 2 e 3 do fluxo "Conectar com GitHub" (ver github-app.service.ts) —
 * o navegador chega aqui vindo do GitHub, não de uma sessão logada do
 * Velix, então **sem** JwtAuthGuard de propósito. Mesmo padrão de
 * `webhooks.controller.ts`: a autenticação não é sessão, é o `state`
 * assinado (JWT de curta duração) que só quem iniciou o fluxo autenticado
 * (endpoint `POST git-accounts/github/manifest`, esse sim guardado) recebeu.
 *
 * Qualquer falha redireciona de volta pro painel com um erro na URL em vez
 * de devolver JSON cru — quem está do outro lado é sempre um navegador no
 * meio de uma navegação, nunca um cliente de API.
 */
@Controller('git-accounts/github')
export class GitHubAppCallbackController {
  constructor(private readonly githubApp: GitHubAppService) {}

  private settingsUrl(params: Record<string, string>) {
    const base = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
    const query = new URLSearchParams({ tab: 'git', ...params });
    return `${base}/settings?${query.toString()}`;
  }

  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      const { installUrl } = await this.githubApp.handleAppCreated(code, state);
      return res.redirect(installUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao criar o GitHub App';
      return res.redirect(this.settingsUrl({ github: 'error', message }));
    }
  }

  @Get('installed')
  async installed(
    @Query('installation_id') installationId: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      await this.githubApp.handleInstalled(installationId, state);
      return res.redirect(this.settingsUrl({ github: 'success' }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao concluir a instalação do GitHub App';
      return res.redirect(this.settingsUrl({ github: 'error', message }));
    }
  }
}
