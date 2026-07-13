import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { buildConnectOptions } from '../ssh/connect-options.util';

type ClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Terminal web (seção 33 do spec): conecta via SSH real e faz proxy
 * bidirecional sobre WebSocket. Autenticação via query string (?token=) —
 * navegador não manda headers customizados no handshake de upgrade.
 *
 * ponytail: sem MFA/gravação de sessão/limite de sessões simultâneas ainda
 * (o spec original pede tudo isso). Sessão dura enquanto a aba ficar aberta.
 */
export function attachTerminalServer(
  httpServer: HttpServer,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parse(req.url ?? '', true);
    if (pathname !== '/terminal') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws, query as Record<string, string>, deps).catch(() => {
        send(ws, { type: 'error', message: 'Falha ao abrir terminal' });
        ws.close();
      });
    });
  });
}

async function handleConnection(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const { token, serverId } = query;
  if (!token || !serverId) {
    send(ws, { type: 'error', message: 'Parâmetros ausentes' });
    ws.close();
    return;
  }

  try {
    await deps.jwt.verifyAsync(token);
  } catch {
    send(ws, { type: 'error', message: 'Token inválido ou expirado' });
    ws.close();
    return;
  }

  const server = await deps.prisma.server.findUnique({ where: { id: serverId } });
  if (!server) {
    send(ws, { type: 'error', message: 'Servidor não encontrado' });
    ws.close();
    return;
  }

  let options;
  try {
    options = buildConnectOptions(server);
  } catch (err) {
    send(ws, { type: 'error', message: err instanceof Error ? err.message : 'Credenciais inválidas' });
    ws.close();
    return;
  }

  const { conn, stream } = await deps.ssh.openShell(options);

  stream.on('data', (chunk: Buffer) => send(ws, { type: 'data', data: chunk.toString('utf8') }));
  stream.stderr.on('data', (chunk: Buffer) => send(ws, { type: 'data', data: chunk.toString('utf8') }));
  stream.on('close', () => {
    send(ws, { type: 'closed' });
    ws.close();
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as ClientMessage;
      if (msg.type === 'input') stream.write(msg.data);
      else if (msg.type === 'resize') stream.setWindow(msg.rows, msg.cols, 0, 0);
    } catch {
      // ignora mensagem mal formada
    }
  });

  ws.on('close', () => conn.end());
  ws.on('error', () => conn.end());
}
