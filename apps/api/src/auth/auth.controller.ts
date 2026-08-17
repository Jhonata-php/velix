import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { TotpService } from './totp.service';
import { DevicePairingTokenService } from './device-pairing-token.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RedeemPairingDto } from './dto/redeem-pairing.dto';
import { JwtAuthGuard, AuthenticatedUser } from './jwt-auth.guard';
import { clientIp } from './client-ip.util';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly totp: TotpService,
    private readonly pairingTokens: DevicePairingTokenService,
  ) {}

  // 10 tentativas/min por IP — generoso pro uso normal (erro de digitação),
  // apertado o bastante pra tornar força bruta impraticável. Guard aplicado
  // só nessa rota (não globalmente) pra não afetar polling de outras telas.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(
      dto.email,
      dto.password,
      clientIp(req),
      req.headers['user-agent'] ?? '',
      dto.rememberMe ?? false,
      dto.totpCode,
    );
  }

  // --- verificação em duas etapas ---
  @UseGuards(JwtAuthGuard)
  @Get('2fa')
  totpStatus(@Req() req: AuthedRequest) {
    return this.totp.status(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/begin')
  totpBegin(@Req() req: AuthedRequest) {
    return this.totp.begin(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/confirm')
  totpConfirm(@Req() req: AuthedRequest, @Body('code') code: string) {
    return this.totp.confirm(req.user.sub, code ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  totpDisable(@Req() req: AuthedRequest, @Body('password') password: string) {
    return this.totp.disable(req.user.sub, password ?? '');
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
      await this.authService.logout(req.user.sid, req.user.sub, clientIp(req), req.headers['user-agent'] ?? '');
    }
    return { message: 'Sessão encerrada.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(@Req() req: AuthedRequest) {
    await this.authService.logoutAll(req.user.sub, clientIp(req), req.headers['user-agent'] ?? '');
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
    await this.authService.revokeSession(id, req.user.sub, clientIp(req), req.headers['user-agent'] ?? '');
    return { message: 'Sessão encerrada.' };
  }

  // Mantém a sessão atual — diferente de /logout-all (usado quando o usuário
  // suspeita de acesso indevido mas ainda quer continuar logado aqui).
  @UseGuards(JwtAuthGuard)
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(@Req() req: AuthedRequest) {
    await this.authService.revokeOtherSessions(req.user.sub, req.user.sid ?? '', clientIp(req), req.headers['user-agent'] ?? '');
    return { message: 'As outras sessões foram encerradas.' };
  }

  // --- pareamento de app móvel via QR code ---

  // Gerado com a pessoa já logada no painel web (ver seção "App móvel" das
  // configurações) — o QR carrega esse token + o domínio, o app escaneia e
  // troca pelo login em /auth/pairing/redeem.
  @UseGuards(JwtAuthGuard)
  @Post('pairing/start')
  async pairingStart(@Req() req: AuthedRequest) {
    const { rawToken, expiresAt } = await this.pairingTokens.issue(req.user.sub);
    return { token: rawToken, expiresAt, ttlSeconds: this.pairingTokens.ttlMinutes * 60 };
  }

  // Sem guard — quem chama ainda não tem sessão, é exatamente o que essa
  // rota concede. A segurança vem do token de uso único e vida curta, não de
  // autenticação prévia (mesmo modelo de /auth/reset-password).
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('pairing/redeem')
  async pairingRedeem(@Body() dto: RedeemPairingDto, @Req() req: Request) {
    const validation = await this.pairingTokens.validate(dto.token);
    if (!validation.valid) {
      throw new UnauthorizedException(
        validation.reason === 'expired'
          ? 'Este QR code expirou. Gere um novo no painel.'
          : 'QR code inválido. Gere um novo no painel.',
      );
    }
    await this.pairingTokens.consume(validation.tokenId);
    return this.authService.pairingLogin(validation.userId, clientIp(req), req.headers['user-agent'] ?? '');
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
      clientIp(req),
      req.headers['user-agent'] ?? '',
    );
    return { message: 'Senha alterada com sucesso.' };
  }
}
