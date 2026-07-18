import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { JwtAuthGuard, AuthenticatedUser } from './jwt-auth.guard';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // 10 tentativas/min por IP — generoso pro uso normal (erro de digitação),
  // apertado o bastante pra tornar força bruta impraticável. Guard aplicado
  // só nessa rota (não globalmente) pra não afetar polling de outras telas.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, req.ip ?? 'unknown', req.headers['user-agent'] ?? '', dto.rememberMe ?? false);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthedRequest) {
    return this.authService.me(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: AuthedRequest) {
    if (req.user.sid) {
      await this.authService.logout(req.user.sid, req.user.sub, req.ip ?? 'unknown', req.headers['user-agent'] ?? '');
    }
    return { message: 'Sessão encerrada.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: AuthedRequest) {
    await this.authService.logoutAll(req.user.sub, req.ip ?? 'unknown', req.headers['user-agent'] ?? '');
    return { message: 'Todas as sessões foram encerradas.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@Req() req: AuthedRequest) {
    return this.authService.listSessions(req.user.sub, req.user.sid ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.authService.revokeSession(id, req.user.sub, req.ip ?? 'unknown', req.headers['user-agent'] ?? '');
    return { message: 'Sessão encerrada.' };
  }

  // Mantém a sessão atual — diferente de /logout-all (usado quando o usuário
  // suspeita de acesso indevido mas ainda quer continuar logado aqui).
  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(@Req() req: AuthedRequest) {
    await this.authService.revokeOtherSessions(req.user.sub, req.user.sid ?? '', req.ip ?? 'unknown', req.headers['user-agent'] ?? '');
    return { message: 'As outras sessões foram encerradas.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthedRequest) {
    await this.authService.changePassword(
      req.user.sub,
      dto.currentPassword,
      dto.newPassword,
      req.user.sid ?? '',
      req.ip ?? 'unknown',
      req.headers['user-agent'] ?? '',
    );
    return { message: 'Senha alterada com sucesso.' };
  }
}
