import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { generateSecret, generateURI, verifySync } from 'otplib';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { AuditService } from '../audit/audit.service';

const RECOVERY_CODE_COUNT = 8;

/**
 * Segundo fator por TOTP.
 *
 * O segredo só é gravado depois que o usuário digita um código válido: guardar
 * na geração deixaria contas em estado meio-ativado — o app de autenticação já
 * mostrando códigos enquanto o login ainda não os exige, e ninguém sabendo
 * qual dos dois vale.
 *
 * Códigos de recuperação são obrigatórios, não opcionais: um painel que
 * controla o SSH de todos os servidores não pode ficar inacessível porque o
 * celular caiu na privada. Ficam como hash — se o banco vazar, eles não servem
 * de chave reserva pro atacante.
 */
@Injectable()
export class TotpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private hashRecoveryCode(code: string) {
    return createHash('sha256').update(code.replace(/-/g, '').toLowerCase()).digest('hex');
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return {
      enabled: !!user.totpEnabledAt,
      enabledAt: user.totpEnabledAt,
      recoveryCodesRemaining: user.recoveryCodesHash.length,
    };
  }

  /** Gera segredo e URI do QR, sem ativar nada ainda. */
  async begin(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (user.totpEnabledAt) throw new BadRequestException('A verificação em duas etapas já está ativa');

    const secret = generateSecret();
    // Guardado cifrado já aqui, mas com totpEnabledAt nulo: é isso que
    // distingue "em configuração" de "ativo". O login só exige código quando
    // totpEnabledAt existe.
    await this.prisma.user.update({ where: { id: userId }, data: { totpSecretEnc: encryptCredential(secret) } });

    return {
      secret,
      otpauthUrl: generateURI({ secret, label: user.email, issuer: 'Velix' }),
    };
  }

  async confirm(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc) throw new BadRequestException('Comece a configuração antes de confirmar');
    if (user.totpEnabledAt) throw new BadRequestException('A verificação em duas etapas já está ativa');

    const secret = decryptCredential(user.totpSecretEnc);
    if (!verifySync({ secret, token: code.replace(/\s/g, '') }).valid) {
      throw new BadRequestException('Código inválido — confira o horário do celular e tente de novo');
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = randomBytes(5).toString('hex');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date(), recoveryCodesHash: codes.map((c) => this.hashRecoveryCode(c)) },
    });
    await this.audit.record({ event: 'TOTP_ENABLED', userId, email: user.email });

    // Única vez em que os códigos existem em claro.
    return { recoveryCodes: codes };
  }

  /** Desativar exige a senha: só ter a sessão aberta não basta pra remover o
   * segundo fator, senão um notebook desbloqueado desfaz a proteção inteira. */
  async disable(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new BadRequestException('Senha incorreta');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabledAt: null, recoveryCodesHash: [] },
    });
    await this.audit.record({ event: 'TOTP_DISABLED', userId, email: user.email });
    return { ok: true };
  }

  /**
   * Verifica no login. Aceita código do app ou de recuperação — este último é
   * consumido, então cada um serve uma vez só.
   */
  async verifyForLogin(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecretEnc) return true;

    const clean = code?.replace(/\s/g, '') ?? '';
    if (!clean) return false;

    if (verifySync({ secret: decryptCredential(user.totpSecretEnc), token: clean }).valid) return true;

    const hash = this.hashRecoveryCode(clean);
    if (user.recoveryCodesHash.includes(hash)) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { recoveryCodesHash: user.recoveryCodesHash.filter((h) => h !== hash) },
      });
      await this.audit.record({ event: 'TOTP_RECOVERY_USED', userId, email: user.email });
      return true;
    }

    return false;
  }
}
