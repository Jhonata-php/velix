import type { Request } from 'express';

/**
 * IP real de quem fez a requisição — nunca o IP do container que repassou.
 *
 * A API só recebe conexões do container do frontend (server.js repassa /api/*),
 * então `req.socket.remoteAddress` é sempre o IP interno do Docker
 * (ex.: ::ffff:172.18.0.4). O IP de verdade chega no X-Forwarded-For, que o
 * server.js do web preenche de forma confiável nos dois modos de instalação
 * (com Traefik: repassa o header sanitizado pelo Traefik; sem Traefik:
 * sobrescreve com o socket, ignorando o que o cliente mandar). Ler isso aqui
 * depende de `trust proxy` estar ligado no main.ts.
 *
 * O prefixo ::ffff: é a forma IPv6-mapped de um IPv4 — só ruído na tela de
 * sessões e nos registros de auditoria.
 */
export function clientIp(req: Request): string {
  const ip = req.ip ?? req.socket?.remoteAddress ?? '';
  const normalized = ip.replace(/^::ffff:/, '');
  return normalized || 'unknown';
}
