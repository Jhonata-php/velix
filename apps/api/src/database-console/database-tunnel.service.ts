import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Duplex } from 'stream';
import { createConnection as createMysqlConnection } from 'mysql2/promise';
import { Client as PgClient } from 'pg';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { decryptCredential } from '../ssh/crypto.util';
import { dbImportSecretKey } from '../terminal/container-shell.util';
import { shellSingleQuote } from '../database/mysql.util';
import { PROXY_NETWORK } from '../traefik/traefik.util';
import { resolveEngine, enginePort, engineUser, type DbEngine } from './database-console.util';

export interface DbConnection {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** Túnel/driver que já se recusam antes de tentar conectar (container
 * parado, credencial errada) lançam `BadRequestException`/`NotFoundException`
 * — deixa passar como está. Qualquer outra coisa (timeout de rede, conexão
 * recusada porque o processo do banco caiu no meio) chegava como erro cru
 * do driver/ssh2, sem `HttpException`, e o Nest mapeia isso pra "Erro
 * interno no servidor" genérico — o usuário via um 500 sem pista nenhuma do
 * que fazer, mesmo quando a causa era óbvia (container parado). */
function toConnectionError(err: unknown): never {
  if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
  const message = err instanceof Error ? err.message : 'Falha desconhecida';
  throw new ServiceUnavailableException(`Não foi possível conectar ao banco — confira se o container está rodando. (${message})`);
}

/**
 * Abre uma conexão real ao banco de um `ProjectService` — a API não tem rota
 * de rede até a rede Docker `velix-proxy` do servidor gerenciado, então o
 * caminho é: resolver o IP do container ali dentro via SSH, abrir um túnel
 * TCP através da mesma conexão SSH (`SshService.openTunnel`), e conectar o
 * driver nativo do motor (mysql2/pg) nesse túnel. Autentica sozinho com a
 * senha root já gerada no deploy — sem pedir login.
 *
 * `withConnection` garante que a conexão do driver e o túnel SSH sempre
 * fecham no `finally`, sucesso ou erro — sem isso cada query deixaria uma
 * conexão SSH pendurada no servidor gerenciado.
 */
@Injectable()
export class DatabaseTunnelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
  ) {}

  async withConnection<T>(
    projectServiceId: string,
    fn: (conn: DbConnection, engine: DbEngine) => Promise<T>,
    /** Nome do banco/schema a conectar, se diferente do `DATABASE_NAME`
     * padrão da implantação — usado pelo seletor de banco da aba Dados,
     * pra navegar outro schema na mesma instância sem mudar o banco
     * "principal" do projeto. */
    databaseOverride?: string,
  ): Promise<T> {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) throw new NotFoundException('Banco não encontrado');

    const engine = resolveEngine(service.image);
    if (!engine) {
      throw new BadRequestException('Este serviço não é um banco de dados suportado (PostgreSQL/MySQL/MariaDB)');
    }

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');

    const secretKey = dbImportSecretKey(service.image);
    const secrets = deployment.secretsEnc
      ? (JSON.parse(decryptCredential(deployment.secretsEnc)) as Record<string, string>)
      : {};
    const password = secretKey ? secrets[secretKey] : undefined;
    if (!password) {
      throw new BadRequestException(
        'Este banco não usa um formato de credenciais compatível com o console embutido — confira se ele foi criado pelo assistente "Criar banco" do Velix.',
      );
    }

    const variables = deployment.variablesJson ? (JSON.parse(deployment.variablesJson) as Record<string, string>) : {};
    const database = databaseOverride || variables.DATABASE_NAME || 'app';

    const application = await this.prisma.application.findUnique({
      where: { id: service.applicationId },
      select: { serverId: true },
    });
    if (!application) throw new NotFoundException('Projeto não encontrado');
    const { options } = await this.servers.getServerWithConnectOptions(application.serverId);

    const inspect = await this.ssh.runCommand(
      options,
      `sudo docker inspect ${shellSingleQuote(service.containerName)} --format '{{(index .NetworkSettings.Networks "${PROXY_NETWORK}").IPAddress}}'`,
      15_000,
    );
    const containerIp = inspect.stdout.trim();
    if (!inspect.ok || !containerIp) {
      throw new BadRequestException('Não foi possível encontrar o container do banco na rede — confira se ele está rodando.');
    }

    let stream: Duplex;
    let close: () => void;
    try {
      ({ stream, close } = await this.ssh.openTunnel(options, containerIp, enginePort(engine)));
    } catch (err) {
      toConnectionError(err);
    }

    try {
      if (engine === 'postgresql') {
        const client = new PgClient({ stream: stream as never, user: engineUser(engine), password, database });
        try {
          await client.connect();
        } catch (err) {
          toConnectionError(err);
        }
        try {
          try {
            await client.query('SET statement_timeout = 30000');
          } catch (err) {
            console.warn('Falha ao aplicar statement_timeout', err);
          }
          const conn: DbConnection = {
            async query(sql, params) {
              const result = await client.query(sql, params as unknown[]);
              return { rows: result.rows as Record<string, unknown>[], rowCount: result.rowCount ?? null };
            },
          };
          return await fn(conn, engine);
        } finally {
          await client.end().catch(() => {});
        }
      }

      let connection: Awaited<ReturnType<typeof createMysqlConnection>>;
      try {
        connection = await createMysqlConnection({ stream: stream as never, user: engineUser(engine), password, database });
      } catch (err) {
        toConnectionError(err);
      }
      try {
        try {
          const timeoutSql = engine === 'mariadb' ? 'SET SESSION max_statement_time=30' : 'SET SESSION MAX_EXECUTION_TIME=30000';
          await connection.query(timeoutSql);
        } catch (err) {
          console.warn('Falha ao aplicar limite de tempo de execução', err);
        }
        const conn: DbConnection = {
          async query(sql, params) {
            const [result] = await connection.query(sql, params);
            if (Array.isArray(result)) {
              return { rows: result as Record<string, unknown>[], rowCount: result.length };
            }
            const info = result as { affectedRows?: number };
            return { rows: [], rowCount: info.affectedRows ?? null };
          },
        };
        return await fn(conn, engine);
      } finally {
        await connection.end().catch(() => {});
      }
    } finally {
      close();
    }
  }
}
