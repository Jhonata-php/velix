import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { ServersService } from '../servers/servers.service';
import { DatabaseService } from '../database/database.service';
import { TraefikService } from '../traefik/traefik.service';
import { ApplicationsService } from '../applications/applications.service';
import { DeployApplicationDto } from '../applications/dto/deploy-application.dto';
import { GitDeployService, DeployFromGitInput } from '../applications/git-deploy.service';

type StartMessage =
  | { type: 'start'; op: 'docker-install' }
  | { type: 'start'; op: 'docker-uninstall' }
  | { type: 'start'; op: 'easypanel-install'; params: { domain?: string; createDnsRecord?: boolean } }
  | { type: 'start'; op: 'easypanel-uninstall' }
  | { type: 'start'; op: 'traefik-install'; params?: { acmeEmail?: string } }
  | { type: 'start'; op: 'traefik-uninstall' }
  | { type: 'start'; op: 'server-prepare'; params?: { acmeEmail?: string } }
  | { type: 'start'; op: 'app-deploy'; params: DeployApplicationDto }
  | { type: 'start'; op: 'git-deploy'; params: DeployFromGitInput }
  | { type: 'start'; op: 'git-redeploy'; params: { applicationId: string } }
  | { type: 'start'; op: 'service-add'; params: { applicationId: string; serviceName: string } }
  | { type: 'start'; op: 'updates-install'; params: { securityOnly?: boolean } }
  | {
      type: 'start';
      op: 'mysql-install';
      params: { name: string; port?: number; databaseName: string; appUser: string; appPassword?: string; rootPassword?: string };
    };

function send(ws: WebSocket, msg: object) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/**
 * Limite de operações simultâneas por usuário.
 *
 * O ThrottlerGuard do Nest só cobre HTTP — este canal é WebSocket e passava
 * sem nenhum limite. Cada conexão aceita dispara um build ou uma instalação no
 * servidor gerenciado; abrir cem de uma vez, com um token válido, derruba a
 * máquina por exaustão de CPU e disco sem precisar de nenhuma falha de
 * autenticação. Três é o suficiente pra qualquer uso legítimo (implantar em
 * alguns servidores ao mesmo tempo) e longe do que causa dano.
 */
const MAX_CONCURRENT_OPS = 3;
const activeOps = new Map<string, number>();

function tryAcquireSlot(userId: string): boolean {
  const current = activeOps.get(userId) ?? 0;
  if (current >= MAX_CONCURRENT_OPS) return false;
  activeOps.set(userId, current + 1);
  return true;
}

function releaseSlot(userId: string) {
  const current = activeOps.get(userId) ?? 0;
  if (current <= 1) activeOps.delete(userId);
  else activeOps.set(userId, current - 1);
}

/**
 * Canal de log ao vivo pra operações demoradas (instalar Docker/EasyPanel,
 * atualizações) — mesmo padrão do /terminal: WebSocket cru, autenticação por
 * query string, um comando roda no servidor de destino e cada linha de saída
 * é repassada em tempo real em vez de só devolver tudo no final.
 */
export function attachOpsServer(
  httpServer: HttpServer,
  deps: {
    jwt: JwtService;
    servers: ServersService;
    database: DatabaseService;
    traefik: TraefikService;
    applications: ApplicationsService;
    gitDeploy: GitDeployService;
  },
) {
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
  deps: {
    jwt: JwtService;
    servers: ServersService;
    database: DatabaseService;
    traefik: TraefikService;
    applications: ApplicationsService;
    gitDeploy: GitDeployService;
  },
) {
  const { token, serverId } = query;
  if (!token || !serverId) {
    send(ws, { type: 'done', ok: false, error: 'Parâmetros ausentes' });
    ws.close();
    return;
  }

  let userId: string;
  try {
    const payload = await deps.jwt.verifyAsync<{ sub: string }>(token);
    userId = payload.sub;
  } catch {
    send(ws, { type: 'done', ok: false, error: 'Token inválido ou expirado' });
    ws.close();
    return;
  }

  if (!tryAcquireSlot(userId)) {
    send(ws, {
      type: 'done',
      ok: false,
      error: `Já existem ${MAX_CONCURRENT_OPS} operações em andamento. Aguarde uma terminar antes de iniciar outra.`,
    });
    ws.close();
    return;
  }
  // Liberado no fechamento, não no fim da operação: se o cliente sumir no meio,
  // o slot precisa voltar de qualquer forma, senão o usuário fica travado.
  ws.once('close', () => releaseSlot(userId));

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
      let result: { ok?: boolean; status?: string };
      if (msg.op === 'docker-install') {
        result = await deps.servers.installDocker(serverId, onLog);
      } else if (msg.op === 'docker-uninstall') {
        result = await deps.servers.uninstallDocker(serverId, onLog);
      } else if (msg.op === 'easypanel-install') {
        result = await deps.servers.installEasyPanel(serverId, msg.params, onLog);
      } else if (msg.op === 'easypanel-uninstall') {
        result = await deps.servers.uninstallEasyPanel(serverId, onLog);
      } else if (msg.op === 'traefik-install') {
        result = await deps.traefik.installTraefik(serverId, msg.params ?? {}, onLog);
      } else if (msg.op === 'traefik-uninstall') {
        result = await deps.traefik.uninstallTraefik(serverId, onLog);
      } else if (msg.op === 'server-prepare') {
        result = await deps.traefik.prepareServer(serverId, msg.params ?? {}, onLog);
      } else if (msg.op === 'app-deploy') {
        result = await deps.applications.deploy(serverId, msg.params, onLog);
      } else if (msg.op === 'git-deploy') {
        result = await deps.gitDeploy.deploy(serverId, msg.params, onLog);
      } else if (msg.op === 'git-redeploy') {
        result = await deps.gitDeploy.redeploy(msg.params.applicationId, onLog);
      } else if (msg.op === 'service-add') {
        result = await deps.applications.addService(msg.params.applicationId, msg.params.serviceName, onLog);
      } else if (msg.op === 'updates-install') {
        result = await deps.servers.installUpdates(serverId, msg.params?.securityOnly ?? false, onLog);
      } else if (msg.op === 'mysql-install') {
        result = await deps.database.installInstance(serverId, msg.params, onLog);
      } else {
        send(ws, { type: 'done', ok: false, error: 'Operação desconhecida' });
        ws.close();
        return;
      }
      const ok = result.status ? result.status === 'ONLINE' : (result.ok ?? true);
      send(ws, { type: 'done', ok, result });
    } catch (err) {
      send(ws, { type: 'done', ok: false, error: err instanceof Error ? err.message : 'Falha na operação' });
    } finally {
      ws.close();
    }
  });
}
