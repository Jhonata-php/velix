export interface FcmResponse {
  success: boolean;
  error?: { code?: string };
}

/**
 * Só remove o token quando o FCM confirma que ele não existe mais
 * (desinstalou o app, trocou de aparelho) — erros transitórios (rede,
 * limite de taxa) não devem apagar um token que ainda pode funcionar depois.
 */
export function collectInvalidTokens(tokens: string[], responses: FcmResponse[]): string[] {
  const invalid: string[] = [];
  responses.forEach((res, i) => {
    if (!res.success && res.error?.code === 'messaging/registration-token-not-registered') {
      invalid.push(tokens[i]);
    }
  });
  return invalid;
}
