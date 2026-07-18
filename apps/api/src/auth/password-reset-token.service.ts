import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const TOKEN_TTL_MINUTES = 30;

export interface IssuedToken {
  rawToken: string;
  expiresAt: Date;
}

export type TokenValidation =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false; reason: 'not_found' | 'expired' | 'used' };

// Só o hash SHA-256 do token toca o banco — o valor bruto existe apenas no
// link enviado por e-mail e nunca é persistido nem logado.
@Injectable()
export class PasswordResetTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async issue(userId: string, ip: string | null, userAgent: string | null): Promise<IssuedToken> {
    // Uma nova solicitação invalida qualquer token anterior ainda não usado
    // do mesmo usuário — evita que um link antigo esquecido continue valendo.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: this.hash(rawToken), expiresAt, requestedIp: ip, userAgent },
    });

    return { rawToken, expiresAt };
  }

  async validate(rawToken: string): Promise<TokenValidation> {
    const tokenHash = this.hash(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record) return { valid: false, reason: 'not_found' };
    if (record.usedAt) return { valid: false, reason: 'used' };
    if (record.expiresAt < new Date()) return { valid: false, reason: 'expired' };
    return { valid: true, userId: record.userId, tokenId: record.id };
  }

  async consume(tokenId: string) {
    await this.prisma.passwordResetToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
  }

  get ttlMinutes() {
    return TOKEN_TTL_MINUTES;
  }
}
