import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from '../audit/audit.module';
import { MailModule } from '../mail/mail.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordRecoveryController } from './password-recovery.controller';
import { PasswordRecoveryService } from './password-recovery.service';
import { PasswordResetTokenService } from './password-reset-token.service';
import { DevicePairingTokenService } from './device-pairing-token.service';
import { SessionService } from './session.service';
import { RolesGuard } from './roles.guard';
import { AccountLockService } from './account-lock.service';
import { TotpService } from './totp.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '12h' },
    }),
    // Só rotas com @Throttle usam o limite explícito — o limite global fica
    // alto o bastante pra nunca incomodar uso normal do painel (polling, etc).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    AuditModule,
    MailModule,
  ],
  providers: [
    AuthService,
    JwtAuthGuard,
    SessionService,
    AccountLockService,
    TotpService,
    PasswordResetTokenService,
    PasswordRecoveryService,
    DevicePairingTokenService,
    RolesGuard,
  ],
  controllers: [AuthController, PasswordRecoveryController],
  exports: [JwtAuthGuard, RolesGuard, SessionService, TotpService],
})
export class AuthModule {}
