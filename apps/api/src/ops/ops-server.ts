import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { ServersService } from '../servers/servers.service';

type StartMessage =
  | { type: 'start'; op: 'docker-install' }
  | { type: 'start'; op: 'easypanel-install'; params: { domain?: string; email: string; createDnsRecord?: boolean } }
  | { type: 'start'; op: 'updates-install'; params: { securityOnly?: boolean } };

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Canal de log ao vivo pra operações demoradas (instalar Docker/EasyPanel,
 * atualizações) — mesmo padrão do /terminal: WebSocket cru, autenticação por
 * query string, um comando roda no servidor de destino e cada linha de saída
 * é repassada em tempo real em vez de só devolver tudo no final.
 */
export function attachOpsServer(httpServer: HttpServer, deps: { jwt: JwtService; servers: ServersService }) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '', true);
    if (pathname !== '/ops') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, query as Record<string, string>, deps).catch((err) => {
        send(ws, { type: 'done', ok: false, error: err instanceof Error ? err.message : 'Falha interna' });
        ws.close();
      });
    });
  });
}

async function handleConnection(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; servers: ServersService },
) {
  const { token, serverId } = query;
  if (!token || !serverId) {
    send(ws, { type: 'done', ok: false, error: 'Parâmetros ausentes' });
    ws.close();
    return;
  }

  try {
    await deps.jwt.verifyAsync(token);
  } catch {
    send(ws, { type: 'done', ok: false, error: 'Token inválido ou expirado' });
    ws.close();
    return;
  }

  ws.once('message', async (raw) => {
    let msg: StartMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'done', ok: false, error: 'Mensagem inválida' });
      ws.close();
      return;
    }

    const onLog = (line: string) => send(ws, { type: 'log', data: line });

    try {
      let result: { ok?: boolean };
      if (msg.op === 'docker-install') {
        result = await deps.servers.installDocker(serverId, onLog);
      } else if (msg.op === 'easypanel-install') {
        result = await deps.servers.installEasyPanel(serverId, msg.params, onLog);
      } else if (msg.op === 'updates-install') {
        result = await deps.servers.installUpdates(serverId, msg.params?.securityOnly ?? false, onLog);
      } else {
        send(ws, { type: 'done', ok: false, error: 'Operação desconhecida' });
        ws.close();
        return;
      }
      send(ws, { type: 'done', ok: result.ok ?? true, result });
    } catch (err) {
      send(ws, { type: 'done', ok: false, error: err instanceof Error ? err.message : 'Falha na operação' });
    } finally {
      ws.close();
    }
  });
}
