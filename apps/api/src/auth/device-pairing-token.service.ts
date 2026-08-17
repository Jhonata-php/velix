import { Injectable } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Curto de propósito: o QR fica na tela por pouco tempo antes de alguém
// escanear, diferente do link de reset de senha que pode ficar dias na caixa
// de entrada. 2 minutos é generoso pro fluxo real (abrir o app, apontar a
// câmera) e apertado pro risco de alguém tirar foto da tela de longe depois.
const TOKEN_TTL_MINUTES = 2;

export interface IssuedPairingToken {
  rawToken: string;
  expiresAt: Date;
}

export type PairingTokenValidation =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false; reason: 'not_found' | 'expired' | 'used' };

// Mesmo padrão do PasswordResetTokenService: só o hash SHA-256 toca o banco,
// o valor bruto existe apenas dentro do QR code e nunca é persistido.
@Injectable()
export class DevicePairingTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  async issue(userId: string): Promise<IssuedPairingToken> {
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000);

    await this.prisma.devicePairingToken.create({
      data: { userId, tokenHash: this.hash(rawToken), expiresAt },
    });

    return { rawToken, expiresAt };
  }

  async validate(rawToken: string): Promise<PairingTokenValidation> {
    const tokenHash = this.hash(rawToken);
    const record = await this.prisma.devicePairingToken.findUnique({ where: { tokenHash } });
    if (!record) return { valid: false, reason: 'not_found' };
    if (record.usedAt) return { valid: false, reason: 'used' };
    if (record.expiresAt < new Date()) return { valid: false, reason: 'expired' };
    return { valid: true, userId: record.userId, tokenId: record.id };
  }

  async consume(tokenId: string) {
    await this.prisma.devicePairingToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } });
  }

  get ttlMinutes() {
    return TOKEN_TTL_MINUTES;
  }
}
