import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { buildConnectOptions } from '../ssh/connect-options.util';
import { decryptCredential } from '../ssh/crypto.util';
import { shellSingleQuote } from '../database/mysql.util';
import { dbConsoleCommand } from './container-shell.util';

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
    if (pathname !== '/terminal' && pathname !== '/db-console' && pathname !== '/service-terminal') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      const handler =
        pathname === '/terminal' ? handleConnection : pathname === '/db-console' ? handleDbConsole : handleServiceTerminal;
      handler(ws, query as Record<string, string>, deps).catch(() => {
        send(ws, { type: 'error', message: 'Falha ao abrir terminal' });
        ws.close();
      });
    });
  });
}

/** Abre o shell, liga o proxy bidirecional WS<->PTY, e devolve o stream (quem chama pode escrever nele antes de retornar). */
async function wirePty(ws: WebSocket, ssh: SshService, options: Parameters<SshService['openShell']>[0]) {
  const { conn, stream } = await ssh.openShell(options);

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

  return stream;
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

  await wirePty(ws, deps.ssh, options);
}

/**
 * Console do MySQL (via `docker exec -it`) — mesma infra do terminal SSH,
 * só que ao abrir já digita o comando de entrar no container e faz login,
 * sem o usuário precisar saber a senha de cor.
 */
async function handleDbConsole(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const { token, instanceId } = query;
  if (!token || !instanceId) {
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

  const instance = await deps.prisma.databaseInstance.findUnique({ where: { id: instanceId }, include: { server: true } });
  if (!instance) {
    send(ws, { type: 'error', message: 'Banco de dados não encontrado' });
    ws.close();
    return;
  }

  let options;
  try {
    options = buildConnectOptions(instance.server);
  } catch (err) {
    send(ws, { type: 'error', message: err instanceof Error ? err.message : 'Credenciais inválidas' });
    ws.close();
    return;
  }

  const rootPassword = decryptCredential(instance.rootPasswordEnc);
  const stream = await wirePty(ws, deps.ssh, options);
  stream.write(`sudo docker exec -it ${instance.containerName} mysql -uroot -p${shellSingleQuote(rootPassword)}\n`);
}

/**
 * Shell dentro de um container de um serviço de projeto — `docker exec -it
 * <container> sh` por padrão, ou o cliente do banco (`mode=db`) quando a
 * imagem é um banco conhecido (ver container-shell.util.ts). Sem login
 * automático no modo banco: diferente do MySQL solto (`handleDbConsole`,
 * que sabe a senha de root porque foi o Velix que gerou), aqui a senha é
 * o que o manifesto do catálogo gerou — o usuário já vê ela pronta na aba
 * Ambiente do serviço, então digitar na hora é mais simples e mais seguro
 * que tentar adivinhar qual variável de ambiente cada manifesto usa.
 */
async function handleServiceTerminal(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const { token, applicationId, serviceName, mode } = query;
  if (!token || !applicationId || !serviceName) {
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

  const application = await deps.prisma.application.findUnique({ where: { id: applicationId }, include: { server: true } });
  if (!application) {
    send(ws, { type: 'error', message: 'Projeto não encontrado' });
    ws.close();
    return;
  }
  const service = await deps.prisma.projectService.findUnique({
    where: { applicationId_name: { applicationId, name: serviceName } },
  });
  if (!service) {
    send(ws, { type: 'error', message: 'Serviço não encontrado neste projeto' });
    ws.close();
    return;
  }

  let options;
  try {
    options = buildConnectOptions(application.server);
  } catch (err) {
    send(ws, { type: 'error', message: err instanceof Error ? err.message : 'Credenciais inválidas' });
    ws.close();
    return;
  }

  const containerName = shellSingleQuote(service.containerName);
  const command = mode === 'db' ? dbConsoleCommand(service.image) : null;

  const stream = await wirePty(ws, deps.ssh, options);
  stream.write(`sudo docker exec -it ${containerName} ${command ?? 'sh'}\n`);
}
