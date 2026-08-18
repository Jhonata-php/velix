/** Funções puras do fluxo de GitHub App via manifest — sem I/O, testáveis
 * sem rede. Ver github-app.util.spec.ts. */
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Nome do App visto no GitHub. Precisa ser único em TODO o GitHub (não só
 * na conta do usuário) — por isso o sufixo aleatório, mesmo que o rótulo
 * escolhido já tenha sido usado por outra instalação do Velix em outro
 * lugar. Limite prático de comprimento do GitHub pra nome de App é curto,
 * daí o corte do rótulo.
 */
export function buildManifestName(label: string, randomSuffix: string): string {
  const clean = label.trim().slice(0, 20) || 'conta';
  return `Velix ${clean} ${randomSuffix}`;
}

export interface ManifestOptions {
  label: string;
  randomSuffix: string;
  webOrigin: string;
}

/** JSON do manifest enviado ao GitHub — https://github.com/settings/apps/new?state=... */
export function buildManifest({ label, randomSuffix, webOrigin }: ManifestOptions) {
  const base = webOrigin.replace(/\/$/, '');
  return {
    name: buildManifestName(label, randomSuffix),
    url: base,
    redirect_url: `${base}/api/git-accounts/github/callback`,
    setup_url: `${base}/api/git-accounts/github/installed`,
    setup_on_update: true,
    public: false,
    // "push" é o único evento que o autodeploy de contas GitHub App precisa
    // (ver GitHubAppWebhookController) — GitHub Apps não conseguem criar
    // webhook clássico por repositório (POST /repos/:owner/:repo/hooks
    // devolve "Resource not accessible by integration" pra token de
    // instalação, mesmo com permissão de administration concedida — testado
    // e confirmado, não é falta de permissão). O jeito certo pra App é um
    // único webhook por instalação, entregando eventos de todos os
    // repositórios — daí esse default_events + hook_attributes.active aqui.
    default_events: ['push'],
    default_permissions: {
      contents: 'read',
      metadata: 'read',
    },
    hook_attributes: {
      url: `${base}/api/webhooks/github-app`,
      active: true,
    },
  };
}

/** HMAC-SHA256 do corpo bruto contra o header `X-Hub-Signature-256` — o
 * `webhookSecret` é o que o próprio GitHub gera na criação do App
 * (data.webhook_secret na conversão do manifest, ver GitHubAppService),
 * autenticando os eventos entregues no webhook central da instalação sem
 * precisar de um segredo nosso. `rawBody` precisa ser o corpo exatamente
 * como chegou — reserializar o JSON já parseado quebraria a comparação
 * (ver `rawBody: true` em main.ts e GitHubAppWebhookController).
 */
export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, webhookSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${createHmac('sha256', webhookSecret).update(rawBody).digest('hex')}`;
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
