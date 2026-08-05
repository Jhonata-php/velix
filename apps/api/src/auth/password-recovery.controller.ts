import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { PasswordRecoveryService } from './password-recovery.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { clientIp } from './client-ip.util';

@Controller('auth')
export class PasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  // Rate limit por IP (aqui) + por e-mail (dentro do service) — um atacante
  // que troca de IP ainda esbarra no limite por e-mail-alvo.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.recovery.forgotPassword(dto.email, clientIp(req), req.headers['user-agent'] ?? '');
    // Sempre a mesma mensagem, exista ou não o e-mail — evita enumeração de usuários.
    return { message: 'Se existir uma conta associada a este e-mail, enviaremos as instruções de recuperação.' };
  }

  @Get('reset-password/validate')
  async validateResetToken(@Query('token') token?: string) {
    if (!token) return { valid: false, reason: 'not_found' as const };
    const result = await this.recovery.validateToken(token);
    return result.valid ? { valid: true as const } : { valid: false as const, reason: result.reason };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.recovery.resetPassword(dto.token, dto.password, clientIp(req), req.headers['user-agent'] ?? '');
    return { message: 'Senha alterada com sucesso.' };
  }
}
