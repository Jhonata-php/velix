import type { Server as HttpServer } from 'http';
import { parse } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { JwtService } from '@nestjs/jwt';
import { ServersService } from '../servers/servers.service';
import { DatabaseService } from '../database/database.service';
import { TraefikService } from '../traefik/traefik.service';
import { ApplicationsService } from '../applications/applications.service';
import { DeployServiceDto } from '../applications/dto/deploy-service.dto';
import { GitDeployService, DeployFromGitInput } from '../applications/git-deploy.service';
import { DatabaseBackupService } from '../database-backup/database-backup.service';

type StartMessage =
  | { type: 'start'; op: 'docker-install' }
  | { type: 'start'; op: 'docker-uninstall' }
  | { type: 'start'; op: 'easypanel-install'; params: { domain?: string; createDnsRecord?: boolean } }
  | { type: 'start'; op: 'easypanel-uninstall' }
  | { type: 'start'; op: 'traefik-install'; params?: { acmeEmail?: string } }
  | { type: 'start'; op: 'traefik-uninstall' }
  | { type: 'start'; op: 'server-prepare'; params?: { acmeEmail?: string } }
  | { type: 'start'; op: 'service-deploy'; params: { applicationId: string } & DeployServiceDto }
  | { type: 'start'; op: 'service-deploy-git'; params: { applicationId: string } & DeployFromGitInput }
  | { type: 'start'; op: 'service-redeploy-git'; params: { deploymentId: string } }
  | { type: 'start'; op: 'container-logs'; params: { containerId: string } }
  | { type: 'start'; op: 'service-add'; params: { deploymentId: string; serviceName: string } }
  | { type: 'start'; op: 'service-db-import'; params: { applicationId: string; serviceName: string; sqlContent: string } }
  | { type: 'start'; op: 'database-backup-run'; params: { projectServiceId: string } }
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
    databaseBackup: DatabaseBackupService;
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
    databaseBackup: DatabaseBackupService;
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
  let role: string;
  try {
    const payload = await deps.jwt.verifyAsync<{ sub: string; role?: string }>(token);
    userId = payload.sub;
    role = payload.role ?? 'viewer';
  } catch {
    send(ws, { type: 'done', ok: false, error: 'Token inválido ou expirado' });
    ws.close();
    return;
  }

  // O RolesGuard só cobre HTTP. Toda operação deste canal instala, implanta ou
  // remove coisa em servidor — nenhuma delas é leitura, então 'viewer' não pode
  // sequer abrir a conexão. Sem esta checagem os papéis seriam contornáveis por
  // WebSocket, que é a parte que de fato executa comando no servidor.
  if (role !== 'admin' && role !== 'operator') {
    send(ws, { type: 'done', ok: false, error: 'Seu perfil não permite executar operações em servidores.' });
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
      } else if (msg.op === 'service-deploy') {
        const { applicationId, ...dto } = msg.params;
        result = await deps.applications.deployManifestIntoProject(applicationId, dto, onLog);
      } else if (msg.op === 'service-deploy-git') {
        const { applicationId, ...dto } = msg.params;
        result = await deps.gitDeploy.deploy(applicationId, dto, onLog);
      } else if (msg.op === 'service-redeploy-git') {
        result = await deps.gitDeploy.redeploy(msg.params.deploymentId, onLog);
      } else if (msg.op === 'container-logs') {
        // Fica aberto até o usuário fechar a aba — não tem "concluído".
        result = await deps.servers.streamContainerLogs(serverId, msg.params.containerId, onLog, ws);
      } else if (msg.op === 'service-add') {
        result = await deps.applications.addService(msg.params.deploymentId, msg.params.serviceName, onLog);
      } else if (msg.op === 'service-db-import') {
        result = await deps.applications.importDatabase(msg.params.applicationId, msg.params.serviceName, msg.params.sqlContent, onLog);
      } else if (msg.op === 'database-backup-run') {
        result = await deps.databaseBackup.run(msg.params.projectServiceId, 'manual', onLog);
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
