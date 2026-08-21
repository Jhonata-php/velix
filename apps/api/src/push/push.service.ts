import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { collectInvalidTokens } from './push.util';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private sender: admin.messaging.Messaging | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  private getSender(): admin.messaging.Messaging | null {
    if (this.sender !== undefined) return this.sender;

    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) {
      this.logger.warn('FIREBASE_SERVICE_ACCOUNT_JSON não configurado — push notification desabilitado.');
      this.sender = null;
      return null;
    }

    try {
      const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
      this.sender = admin.messaging(app);
    } catch (err) {
      this.logger.error(`Falha ao inicializar Firebase: ${err instanceof Error ? err.message : err}`);
      this.sender = null;
    }
    return this.sender;
  }

  async registerDevice(userId: string, platform: 'ios' | 'android', fcmToken: string) {
    await this.prisma.deviceToken.upsert({
      where: { fcmToken },
      update: { userId, platform, lastSeenAt: new Date() },
      create: { userId, platform, fcmToken },
    });
  }

  async unregisterDevice(userId: string, id: string) {
    await this.prisma.deviceToken.deleteMany({ where: { id, userId } });
  }

  async sendToUser(userId: string, message: PushMessage) {
    const devices = await this.prisma.deviceToken.findMany({ where: { userId } });
    await this.sendToTokens(devices.map((d) => d.fcmToken), message);
  }

  /** Broadcast pra todo dispositivo registrado — usado por avisos que não são
   * de um usuário específico (ex.: nova versão do Velix disponível). */
  async sendToAll(message: PushMessage) {
    const devices = await this.prisma.deviceToken.findMany({ select: { fcmToken: true } });
    await this.sendToTokens(devices.map((d) => d.fcmToken), message);
  }

  private async sendToTokens(tokens: string[], message: PushMessage) {
    const sender = this.getSender();
    if (!sender || tokens.length === 0) return;

    // sendEachForMulticast aceita até 500 tokens por chamada.
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      let result: admin.messaging.BatchResponse;
      try {
        result = await sender.sendEachForMulticast({
          tokens: batch,
          notification: { title: message.title, body: message.body },
          data: message.data,
        });
      } catch (err) {
        this.logger.warn(`Falha ao enviar push: ${err instanceof Error ? err.message : err}`);
        continue;
      }

      const invalid = collectInvalidTokens(batch, result.responses);
      if (invalid.length > 0) {
        await this.prisma.deviceToken.deleteMany({ where: { fcmToken: { in: invalid } } });
      }
    }
  }
}
