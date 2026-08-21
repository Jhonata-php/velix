import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import type { Client, ClientChannel } from 'ssh2';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, type SshConnectOptions } from '../ssh/ssh.service';
import { buildConnectOptions } from '../ssh/connect-options.util';
import { decryptCredential } from '../ssh/crypto.util';
import { shellSingleQuote } from '../database/mysql.util';
import { dbConsoleCommand, dbImportSecretKey } from './container-shell.util';
import { resolveEngine, engineUser } from '../database-console/database-console.util';

type ClientMessage = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number };

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Verifica o token e devolve `sub`/`role` do payload, ou fecha a conexão e
 * devolve `null`. Abrir um terminal é sempre uma ação de escrita (shell com
 * privilégio de root via sudo, ou console de banco), então 'viewer' não pode
 * — mesma checagem que ops-server.ts já faz pro canal de operações, e pelo
 * mesmo motivo: o RolesGuard só cobre rotas HTTP, não WebSocket, então sem
 * isto aqui os papéis seriam contornáveis abrindo a conexão direto.
 */
async function authenticate(
  ws: WebSocket,
  jwt: JwtService,
  token: string | undefined,
): Promise<{ sub: string; role: string } | null> {
  if (!token) {
    send(ws, { type: 'error', message: 'Parâmetros ausentes' });
    ws.close();
    return null;
  }

  let payload: { sub: string; role?: string };
  try {
    payload = await jwt.verifyAsync(token);
  } catch {
    send(ws, { type: 'error', message: 'Token inválido ou expirado' });
    ws.close();
    return null;
  }

  const role = payload.role ?? 'viewer';
  if (role !== 'admin' && role !== 'operator') {
    send(ws, { type: 'error', message: 'Seu perfil não permite abrir um terminal.' });
    ws.close();
    return null;
  }

  return { sub: payload.sub, role };
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

/** Liga o proxy bidirecional WS<->PTY num canal já aberto (ver `wireExecPty`). */
function wireStream(ws: WebSocket, conn: Client, stream: ClientChannel) {
  // Sem isso, qualquer proxy no caminho entre o navegador e a API (Traefik,
  // Cloudflare) pode derrubar o WebSocket por "conexão ociosa" no meio de uma
  // sessão de terminal parada (ninguém digitando por um tempo) — um ping a
  // cada 20s conta como atividade e mantém a conexão viva.
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 20_000);

  stream.on('data', (chunk: Buffer) => send(ws, { type: 'data', data: chunk.toString('utf8') }));
  stream.stderr.on('data', (chunk: Buffer) => send(ws, { type: 'data', data: chunk.toString('utf8') }));
  stream.on('close', () => {
    clearInterval(heartbeat);
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

  ws.on('close', () => {
    clearInterval(heartbeat);
    conn.end();
  });
  ws.on('error', () => {
    clearInterval(heartbeat);
    conn.end();
  });
}

/** Roda `command` direto com PTY, sem abrir shell de login antes — usado por
 * todo terminal (`/terminal`, `/db-console`, `/service-terminal`): o sshd só
 * imprime o banner de boas-vindas do host (MOTD, updates disponíveis etc.)
 * quando abre um shell de login de verdade; passando um comando fixo (nem
 * que seja só `bash -l`) esse banner nunca aparece. Pro terminal escopado a
 * um container, tem o bônus de fechar o canal inteiro quando o usuário sai
 * do shell do container, sem sobrar um shell do host por trás pra "escapar". */
async function wireExecPty(ws: WebSocket, ssh: SshService, options: SshConnectOptions, command: string) {
  const { conn, stream } = await ssh.execPty(options, command);
  wireStream(ws, conn, stream);
  return stream;
}

async function handleConnection(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const { token, serverId } = query;
  if (!serverId) {
    send(ws, { type: 'error', message: 'Parâmetros ausentes' });
    ws.close();
    return;
  }

  if (!(await authenticate(ws, deps.jwt, token))) return;

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

  // `wireExecPty` em vez de `wirePty`: mesmo motivo do terminal de container
  // (ver comentário acima) — como aqui o comando já é fixo (`bash -l`), o
  // sshd não trata como shell de login e não imprime o banner de boas-vindas
  // do Ubuntu (updates, MOTD, "System information"), só o prompt direto.
  await wireExecPty(ws, deps.ssh, options, 'bash -l');
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
  if (!instanceId) {
    send(ws, { type: 'error', message: 'Parâmetros ausentes' });
    ws.close();
    return;
  }

  if (!(await authenticate(ws, deps.jwt, token))) return;

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
  const command = `sudo docker exec -it ${shellSingleQuote(instance.containerName)} mysql -uroot -p${shellSingleQuote(rootPassword)}`;
  await wireExecPty(ws, deps.ssh, options, command);
}

/**
 * Shell dentro de um container de um serviço de projeto — `docker exec -it
 * <container> sh` por padrão, ou o cliente do banco (`mode=db`) quando a
 * imagem é um banco conhecido (ver container-shell.util.ts). Login
 * automático no modo banco para os três motores oficiais do catálogo
 * (Postgres/MySQL/MariaDB) — mesma senha root que a aba "Dados" e o
 * "Importar .sql" já usam. Pra qualquer outro tipo de imagem (Mongo, Redis,
 * bancos de app-stacks de terceiros cujo segredo não está num formato
 * conhecido) cai no cliente sem login, que pede a senha na hora.
 */
async function handleServiceTerminal(
  ws: WebSocket,
  query: Record<string, string>,
  deps: { jwt: JwtService; prisma: PrismaService; ssh: SshService },
) {
  const { token, applicationId, serviceName, mode, shell } = query;
  if (!applicationId || !serviceName) {
    send(ws, { type: 'error', message: 'Parâmetros ausentes' });
    ws.close();
    return;
  }
  // Lista fechada — isso vira parte de um comando `docker exec` executado
  // por SSH como root; melhor recusar um valor inesperado que tentar escapar.
  const shellBin = shell === 'bash' ? 'bash' : 'sh';

  if (!(await authenticate(ws, deps.jwt, token))) return;

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
  let execFlags = '';
  let command: string | null = mode === 'db' ? dbConsoleCommand(service.image) : shellBin;

  // Login automático no modo banco: pros três motores oficiais do catálogo
  // (Postgres/MySQL/MariaDB) a senha root já foi gerada pelo Velix no deploy
  // e mora em `secretsEnc` — mesma fonte que a aba "Dados" e o "Importar
  // .sql" já usam (dbImportSecretKey). Sem isso, o usuário caía direto num
  // prompt de senha do próprio mysql/psql sem nenhuma pista de que precisava
  // digitar algo, e "console do banco não funciona" era o relato — o cliente
  // tá lá, só esperando a senha que o usuário não sabia que precisava dar.
  if (mode === 'db') {
    const engine = resolveEngine(service.image);
    if (engine) {
      const secretKey = dbImportSecretKey(service.image);
      const deployment = await deps.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
      const secrets = deployment?.secretsEnc ? (JSON.parse(decryptCredential(deployment.secretsEnc)) as Record<string, string>) : {};
      const password = secretKey ? secrets[secretKey] : undefined;
      if (password) {
        if (engine === 'postgresql') {
          execFlags = `-e PGPASSWORD=${shellSingleQuote(password)} `;
          command = `psql -U ${engineUser(engine)}`;
        } else {
          command = `mysql -u${engineUser(engine)} -p${shellSingleQuote(password)}`;
        }
      }
    }
  }

  const execCommand = `sudo docker exec ${execFlags}-it ${containerName} ${command ?? 'sh'}`;
  await wireExecPty(ws, deps.ssh, options, execCommand);
}
