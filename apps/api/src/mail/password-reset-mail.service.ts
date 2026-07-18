import { Injectable } from '@nestjs/common';
import { MailService } from './mail.service';

interface ResetMailInput {
  to: string;
  userName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

@Injectable()
export class PasswordResetMailService {
  constructor(private readonly mail: MailService) {}

  send(input: ResetMailInput) {
    return this.mail.send({
      to: input.to,
      subject: 'Redefinição de senha — Velix',
      html: buildHtml(input),
      text: buildText(input),
    });
  }
}

function buildHtml({ userName, resetUrl, expiresInMinutes }: ResetMailInput): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:#09090b;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#09090b;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#111113;border-radius:16px;border:1px solid #2a2a2e;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 0 32px;text-align:center;">
                <div style="display:inline-block;width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,#7c6cff,#4a3fb0);color:#fff;font-weight:700;font-size:20px;line-height:48px;">V</div>
                <h1 style="color:#f7f7f7;font-size:20px;margin:16px 0 0;">Velix</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 8px;color:#f7f7f7;font-size:16px;">
                Olá, ${escapeHtml(userName)}.
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;color:#9c9c9c;font-size:14px;line-height:1.6;">
                Recebemos uma solicitação para redefinir a senha da sua conta no Velix. Se foi você, clique no botão abaixo para escolher uma nova senha.
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px;text-align:center;">
                <a href="${resetUrl}" style="display:inline-block;background:#7c6cff;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 28px;border-radius:10px;">Redefinir senha</a>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;color:#767676;font-size:12px;line-height:1.6;">
                Este link expira em ${expiresInMinutes} minutos e só pode ser usado uma vez. Se você não solicitou essa redefinição, pode ignorar este e-mail com segurança — sua senha não será alterada.
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 0;color:#5a5a5a;font-size:11px;line-height:1.6;border-top:1px solid #1c1c1f;">
                Se o botão não funcionar, copie e cole este link no navegador:<br/>
                <span style="word-break:break-all;color:#8f7cff;">${resetUrl}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;color:#5a5a5a;font-size:11px;text-align:center;">
                Velix — Controle. Continuidade. Disponibilidade.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildText({ userName, resetUrl, expiresInMinutes }: ResetMailInput): string {
  return `Olá, ${userName}.

Recebemos uma solicitação para redefinir a senha da sua conta no Velix.

Redefina sua senha acessando o link abaixo (válido por ${expiresInMinutes} minutos, uso único):
${resetUrl}

Se você não solicitou essa redefinição, ignore este e-mail — sua senha não será alterada.

Velix — Controle. Continuidade. Disponibilidade.`;
}

function escapeHtml(value: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (c) => map[c]);
}
