import { Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { UpdateService } from './update.service';
import { SelfUpdateService } from './self-update.service';

@Controller('updates')
@UseGuards(JwtAuthGuard)
export class UpdateController {
  constructor(
    private readonly updates: UpdateService,
    private readonly selfUpdate: SelfUpdateService,
  ) {}

  @Get('current')
  current() {
    return this.updates.getCurrent();
  }

  @Get('latest')
  latest() {
    return this.updates.check({ force: false });
  }

  @Post('check')
  forceCheck() {
    return this.updates.check({ force: true });
  }

  /** Estado da atualização em andamento — o painel consulta em laço enquanto
   * a tela de "aguarde" está aberta, inclusive durante o restart da própria API
   * (o arquivo de estado vive no host, não no container). */
  @Get('apply/status')
  applyStatus() {
    return this.selfUpdate.getStatus();
  }

  /** Só registra o pedido; quem aplica é o host (ver SelfUpdateService). */
  @Post('apply')
  apply(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.selfUpdate.request(req.user.email);
  }

  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.updates.history(limit ? parseInt(limit, 10) : undefined);
  }
}
