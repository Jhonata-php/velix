import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  delivered: boolean;
  reason?: 'smtp_not_configured' | 'send_failed';
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly fromHeader: string;

  constructor() {
    this.transporter = this.buildTransporter();
    const fromName = process.env.SMTP_FROM_NAME?.trim() || 'Velix';
    const fromEmail = process.env.SMTP_FROM_EMAIL?.trim() || 'no-reply@velix.local';
    this.fromHeader = `"${fromName}" <${fromEmail}>`;
  }

  private buildTransporter(): nodemailer.Transporter | null {
    const host = process.env.SMTP_HOST?.trim();
    if (!host) return null;
    return nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
    });
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    if (!this.transporter) {
      // Sem SMTP configurado (instalação nova / dev) — não falha o fluxo,
      // só registra o que seria enviado. Isso permite testar todo o resto
      // do fluxo de recuperação (token, expiração, telas) sem depender de
      // um servidor SMTP real; em produção basta preencher SMTP_HOST.
      this.logger.warn(`SMTP não configurado — e-mail não enviado. Assunto="${input.subject}" Para=${input.to}`);
      this.logger.warn(`[dev-only] Conteúdo (texto): ${input.text}`);
      return { delivered: false, reason: 'smtp_not_configured' };
    }

    try {
      await this.transporter.sendMail({
        from: this.fromHeader,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { delivered: true };
    } catch (err) {
      this.logger.error(`Falha ao enviar e-mail para ${input.to}: ${err instanceof Error ? err.message : err}`);
      return { delivered: false, reason: 'send_failed' };
    }
  }
}
