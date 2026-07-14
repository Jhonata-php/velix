import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { generatePassword, shellSingleQuote, parseReplicaStatus } from './mysql.util';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { CreateReplicaDto } from './dto/create-replica.dto';

function toPublicInstance<T extends { rootPasswordEnc: string; appPasswordEnc: string }>(instance: T) {
  const { rootPasswordEnc: _r, appPasswordEnc: _a, ...rest } = instance;
  return rest;
}

const PORT_EXPOSURE_WARNING =
  'Porta publicada em 0.0.0.0 no servidor — restrinja por firewall (ufw) aos IPs que realmente precisam acessar o banco.';

@Injectable()
export class DatabaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly servers: ServersService,
  ) {}

  private async getRawInstance(id: string) {
    const instance = await this.prisma.databaseInstance.findUnique({ where: { id } });
    if (!instance) throw new NotFoundException('Instância de banco não encontrada');
    return instance;
  }

  private async runMysql(
    options: SshConnectOptions,
    containerName: string,
    rootPassword: string,
    sql: string,
    { vertical = false, timeoutMs = 30_000 }: { vertical?: boolean; timeoutMs?: number } = {},
  ) {
    const finalSql = vertical ? `${sql}\\G` : sql;
    const command = `sudo docker exec ${containerName} mysql -uroot -p${shellSingleQuote(rootPassword)} -e ${shellSingleQuote(finalSql)}`;
    return this.ssh.runCommand(options, command, timeoutMs);
  }

  // ponytail: mesmo motivo do timing do EasyPanel — na primeira instalação o
  // MySQL ainda baixa a imagem e faz DOIS boots internos (bootstrap +
  // start real), o que passa fácil de 60s. 40 tentativas de 5s (~200s) dá
  // margem sem travar pra sempre se algo estiver mesmo quebrado.
  private async waitForMysqlReady(
    options: SshConnectOptions,
    containerName: string,
    rootPassword: string,
    onLog?: (line: string) => void,
    attempts = 40,
    delayMs = 5000,
  ) {
    // ponytail: `mysqladmin ping` sozinho dá falso positivo — ele responde com
    // sucesso já contra a instância de bootstrap (que sobe só pra rodar o SQL de
    // inicialização e cai pra dar lugar à definitiva). Confirmado via `docker logs`:
    // a entrypoint da imagem oficial loga "Stopping temporary server" quando a
    // bootstrap termina — exigir "ready for connections" DEPOIS dessa marca garante
    // que é o mysqld definitivo, não a instância temporária de bootstrap.
    for (let i = 0; i < attempts; i++) {
      const logs = await this.ssh.runCommand(options, `sudo docker logs --tail 300 ${containerName} 2>&1`, 10_000);
      const stopIdx = logs.stdout.search(/stopping temporary server/i);
      const trulyReady = stopIdx !== -1 && /ready for connections/i.test(logs.stdout.slice(stopIdx));
      if (trulyReady) {
        const ping = await this.ssh.runCommand(
          options,
          `sudo docker exec ${containerName} mysqladmin ping -uroot -p${shellSingleQuote(rootPassword)} --silent`,
          10_000,
        );
        if (ping.ok) return true;
      }
      onLog?.(`Aguardando o MySQL ficar pronto... (tentativa ${i + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  async listInstances(serverId: string) {
    const instances = await this.prisma.databaseInstance.findMany({ where: { serverId }, orderBy: { createdAt: 'desc' } });
    return instances.map(toPublicInstance);
  }

  /** Instâncias STANDALONE/PRIMARY de qualquer servidor — candidatas a virar réplica em outro lugar. */
  async listEligiblePrimaries(excludeServerId?: string) {
    const instances = await this.prisma.databaseInstance.findMany({
      where: { role: { in: ['STANDALONE', 'PRIMARY'] }, ...(excludeServerId ? { serverId: { not: excludeServerId } } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { server: { select: { name: true } } },
    });
    return instances.map((i) => ({ id: i.id, name: i.name, serverName: i.server.name, databaseName: i.databaseName }));
  }

  async findOne(id: string) {
    const instance = await this.prisma.databaseInstance.findUnique({
      where: { id },
      include: { replicationsAsPrimary: true, replicationAsReplica: true },
    });
    if (!instance) throw new NotFoundException('Instância de banco não encontrada');
    const { rootPasswordEnc: _r, appPasswordEnc: _a, ...rest } = instance;
    return rest;
  }

  async installInstance(serverId: string, dto: CreateInstanceDto, onLog?: (line: string) => void) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de criar um banco de dados');
    }

    const containerName = `velix-mysql-${dto.name}`;
    const port = dto.port ?? 3306;
    const rootPassword = dto.rootPassword ?? generatePassword();
    const appPassword = dto.appPassword ?? generatePassword();
    const mysqlServerId = Math.floor(Math.random() * 900_000) + 100_000;

    const runCmd = [
      'sudo docker run -d',
      `--name ${containerName}`,
      '--restart unless-stopped',
      `-p ${port}:3306`,
      `-e MYSQL_ROOT_PASSWORD=${shellSingleQuote(rootPassword)}`,
      `-e MYSQL_DATABASE=${shellSingleQuote(dto.databaseName)}`,
      `-e MYSQL_USER=${shellSingleQuote(dto.appUser)}`,
      `-e MYSQL_PASSWORD=${shellSingleQuote(appPassword)}`,
      `-v ${containerName}_data:/var/lib/mysql`,
      'mysql:8.0',
      `--server-id=${mysqlServerId}`,
      '--log-bin=mysql-bin',
      '--gtid-mode=ON',
      '--enforce-gtid-consistency=ON',
      '--log-replica-updates=ON',
      '--binlog-format=ROW',
    ].join(' ');

    onLog?.('Criando container do MySQL...\n');
    const run = await this.ssh.runCommand(options, runCmd, 180_000);
    if (!run.ok) {
      // ponytail: mesmo motivo do createReplica — sem isso, um container/volume
      // órfão (docker create sucedeu, start falhou por porta em uso etc.) trava
      // a próxima tentativa com o mesmo nome com um erro de conflito confuso.
      await this.ssh
        .runCommand(options, `sudo docker rm -f ${containerName}; sudo docker volume rm ${containerName}_data`, 30_000)
        .catch(() => undefined);
      throw new BadRequestException(`Falha ao criar container MySQL: ${run.stderr || run.stdout || run.message}`);
    }

    const instance = await this.prisma.databaseInstance.create({
      data: {
        serverId,
        name: dto.name,
        containerName,
        port,
        mysqlServerId,
        databaseName: dto.databaseName,
        appUser: dto.appUser,
        appPasswordEnc: encryptCredential(appPassword),
        rootPasswordEnc: encryptCredential(rootPassword),
      },
    });

    onLog?.('Aguardando o MySQL inicializar (baixa a imagem e faz o bootstrap inicial — pode levar 1-2 minutos)...\n');
    const ready = await this.waitForMysqlReady(options, containerName, rootPassword, onLog);
    let version: string | undefined;
    if (ready) {
      const versionRes = await this.runMysql(options, containerName, rootPassword, 'SELECT VERSION()');
      version = versionRes.stdout.split('\n')[1]?.trim();
    }

    const updated = await this.prisma.databaseInstance.update({
      where: { id: instance.id },
      data: { status: ready ? 'ONLINE' : 'ERROR', version, lastCheckedAt: new Date() },
    });

    if (ready) {
      const mirror = await this.prisma.serverMirror.findUnique({ where: { sourceServerId: serverId } });
      if (mirror) {
        onLog?.(`Espelhamento ativo — replicando "${dto.name}" para o servidor espelho em segundo plano...\n`);
        // ponytail: fire-and-forget — não trava a resposta do install nisso, é
        // exatamente pra rodar em segundo plano. Falha aqui só fica no log do
        // servidor; a réplica simplesmente não aparece se der errado (mesma
        // limitação de visibilidade que qualquer job sem fila neste projeto).
        this.createReplica(updated.id, { targetServerId: mirror.targetServerId, name: dto.name }).catch((err) => {
          console.error(`[mirror] falha ao replicar "${dto.name}" para o servidor espelho:`, err);
        });
      }
    }

    return {
      ...toPublicInstance(updated),
      rootPassword,
      appPassword,
      warnings: [PORT_EXPOSURE_WARNING, 'As senhas acima só são mostradas agora — guarde-as em local seguro.'],
    };
  }

  async remove(id: string) {
    const instance = await this.getRawInstance(id);
    await this.prisma.databaseReplication.deleteMany({
      where: { OR: [{ primaryInstanceId: id }, { replicaInstanceId: id }] },
    });
    try {
      const { options } = await this.servers.getServerWithConnectOptions(instance.serverId);
      await this.ssh.runCommand(options, `sudo docker rm -f ${instance.containerName}`, 30_000);
    } catch {
      // servidor pode estar inacessível; ainda assim remove o registro para não travar a UI
    }
    await this.prisma.databaseInstance.delete({ where: { id } });
    return { ok: true };
  }

  async start(id: string) {
    const instance = await this.getRawInstance(id);
    const { options } = await this.servers.getServerWithConnectOptions(instance.serverId);
    const result = await this.ssh.runCommand(options, `sudo docker start ${instance.containerName}`, 30_000);
    if (!result.ok) throw new BadRequestException(`Falha ao iniciar instância: ${result.stderr || result.message}`);
    await this.prisma.databaseInstance.update({ where: { id }, data: { status: 'ONLINE', lastCheckedAt: new Date() } });
    return { ok: true };
  }

  async stop(id: string) {
    const instance = await this.getRawInstance(id);
    const { options } = await this.servers.getServerWithConnectOptions(instance.serverId);
    const result = await this.ssh.runCommand(options, `sudo docker stop ${instance.containerName}`, 30_000);
    if (!result.ok) throw new BadRequestException(`Falha ao parar instância: ${result.stderr || result.message}`);
    await this.prisma.databaseInstance.update({ where: { id }, data: { status: 'OFFLINE', lastCheckedAt: new Date() } });
    return { ok: true };
  }

  /**
   * Dispara réplica de vários bancos primários pro mesmo destino de uma vez —
   * usado tanto pela seleção em massa quanto pelo "pegar os que já existem"
   * ao ativar o espelhamento. Roda em segundo plano, uma de cada vez (não em
   * paralelo, pra não sobrecarregar o primário com vários dumps simultâneos).
   */
  replicateBulk(primaryInstanceIds: string[], targetServerId: string) {
    void (async () => {
      for (const id of primaryInstanceIds) {
        const primary = await this.prisma.databaseInstance.findUnique({ where: { id } });
        if (!primary) continue;
        try {
          await this.createReplica(id, { targetServerId, name: primary.name });
        } catch (err) {
          console.error(`[bulk-replicate] falha ao replicar "${primary.name}":`, err);
        }
      }
    })();
    return { ok: true, queued: primaryInstanceIds.length };
  }

  async status(id: string) {
    const instance = await this.getRawInstance(id);
    const { options } = await this.servers.getServerWithConnectOptions(instance.serverId);
    const rootPassword = decryptCredential(instance.rootPasswordEnc);
    const ping = await this.ssh.runCommand(
      options,
      `sudo docker exec ${instance.containerName} mysqladmin ping -uroot -p${shellSingleQuote(rootPassword)} --silent`,
      10_000,
    );
    const status = ping.ok ? 'ONLINE' : 'OFFLINE';
    await this.prisma.databaseInstance.update({ where: { id }, data: { status, lastCheckedAt: new Date() } });
    return { status };
  }

  async createReplica(primaryInstanceId: string, dto: CreateReplicaDto) {
    const primary = await this.getRawInstance(primaryInstanceId);
    if (primary.role === 'REPLICA') {
      throw new BadRequestException('Não é possível criar uma réplica a partir de outra réplica');
    }
    const primaryConn = await this.servers.getServerWithConnectOptions(primary.serverId);
    const targetConn = await this.servers.getServerWithConnectOptions(dto.targetServerId);
    if (!targetConn.server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker no servidor de destino antes de criar a réplica');
    }

    const primaryRootPassword = decryptCredential(primary.rootPasswordEnc);
    const appPassword = decryptCredential(primary.appPasswordEnc);
    const primaryHost = primaryConn.server.privateIp || primaryConn.server.publicIp || primaryConn.server.hostname;
    if (!primaryHost) throw new BadRequestException('Servidor primário sem IP/hostname cadastrado');

    // 1. Dump consistente do primário (fica em memória — ok para bancos pequenos/médios).
    // ponytail: mysqldump via SSH exec, sem streaming direto entre servidores.
    // Trocar por snapshot de volume/streaming quando os bancos crescerem muito.
    const dumpRes = await this.ssh.runCommand(
      primaryConn.options,
      `sudo docker exec ${primary.containerName} mysqldump -uroot -p${shellSingleQuote(primaryRootPassword)} --single-transaction --set-gtid-purged=ON --databases ${primary.databaseName}`,
      300_000,
    );
    if (!dumpRes.ok) {
      throw new BadRequestException(`Falha ao gerar dump do banco primário: ${dumpRes.stderr || dumpRes.message}`);
    }

    const localDumpPath = path.join(os.tmpdir(), `velix-dump-${randomUUID()}.sql`);
    await fs.writeFile(localDumpPath, dumpRes.stdout, 'utf8');

    try {
      // 2. Sobe o MySQL de destino já como réplica (read-only, GTID habilitado).
      const containerName = `velix-mysql-${dto.name}`;
      // ponytail: sem porta explícita, escolhe a primeira livre no destino —
      // essencial pro espelhamento automático (sem ninguém pra escolher a porta
      // na hora) quando o destino já tem outra instância na 3306.
      let port = dto.port;
      if (!port) {
        const used = await this.prisma.databaseInstance.findMany({
          where: { serverId: dto.targetServerId },
          select: { port: true },
        });
        const usedPorts = new Set(used.map((u) => u.port));
        port = 3306;
        while (usedPorts.has(port)) port++;
      }
      const replicaRootPassword = generatePassword();
      const mysqlServerId = Math.floor(Math.random() * 900_000) + 100_000;

      // ponytail: read-only/super-read-only NÃO entram como flag de boot do mysqld —
      // super_read_only bloqueia até a própria escrita interna da entrypoint oficial
      // (criar usuário root, aplicar senha), travando o container num crash-loop
      // silencioso (confirmado via docker inspect: restarts > 0, sem erro explícito).
      // Aplicado depois, via SQL, uma vez a réplica já configurada.
      const runCmd = [
        'sudo docker run -d',
        `--name ${containerName}`,
        '--restart unless-stopped',
        `-p ${port}:3306`,
        `-e MYSQL_ROOT_PASSWORD=${shellSingleQuote(replicaRootPassword)}`,
        `-v ${containerName}_data:/var/lib/mysql`,
        'mysql:8.0',
        `--server-id=${mysqlServerId}`,
        '--log-bin=mysql-bin',
        '--gtid-mode=ON',
        '--enforce-gtid-consistency=ON',
        '--log-replica-updates=ON',
        '--binlog-format=ROW',
      ].join(' ');

      let replUser = '';
      let replPassword = '';
      try {
        const run = await this.ssh.runCommand(targetConn.options, runCmd, 180_000);
        if (!run.ok) {
          throw new BadRequestException(`Falha ao criar container MySQL de destino: ${run.stderr || run.stdout || run.message}`);
        }

        const ready = await this.waitForMysqlReady(targetConn.options, containerName, replicaRootPassword);
        if (!ready) {
          throw new BadRequestException('MySQL de destino não respondeu a tempo após a criação do container');
        }

        // 3. Copia e carrega o dump.
        const remoteDumpPath = `/tmp/velix-dump-${randomUUID()}.sql`;
        const upload = await this.ssh.uploadFile(targetConn.options, localDumpPath, remoteDumpPath);
        if (!upload.ok) {
          throw new BadRequestException(`Falha ao copiar dump para o servidor de destino: ${upload.message}`);
        }
        const loadCmd = `sudo docker exec -i ${containerName} mysql -uroot -p${shellSingleQuote(replicaRootPassword)} < ${remoteDumpPath}`;
        let load = await this.ssh.runCommand(targetConn.options, loadCmd, 300_000);
        if (!load.ok) {
          // ponytail: às vezes o próprio auth ainda não assentou logo após o ping de
          // prontidão confirmar a senha (visto em produção como "Access denied"
          // pontual) — uma segunda tentativa após pausa curta cobre isso sem
          // precisar investigar mais a fundo o boot interno do mysql:8.
          await new Promise((r) => setTimeout(r, 5000));
          load = await this.ssh.runCommand(targetConn.options, loadCmd, 300_000);
        }
        await this.ssh.runCommand(targetConn.options, `rm -f ${remoteDumpPath}`, 10_000);
        if (!load.ok) {
          const logs = await this.ssh.runCommand(targetConn.options, `sudo docker logs --tail 60 ${containerName}`, 10_000);
          const inspect = await this.ssh.runCommand(
            targetConn.options,
            `sudo docker inspect ${containerName} --format '{{.State.Status}} restarts={{.RestartCount}} exitCode={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}}'`,
            10_000,
          );
          throw new BadRequestException(
            `Falha ao carregar dump no destino: ${load.stderr || load.message}\n\n--- docker inspect ---\n${inspect.stdout || inspect.stderr}\n\n--- docker logs ${containerName} ---\n${logs.stdout || logs.stderr || '(sem log)'}`,
          );
        }

        // 4. Cria o usuário de replicação no primário e aponta a réplica pra ele (GTID auto-position).
        replUser = `repl_${dto.name}`;
        replPassword = generatePassword();
        await this.runMysql(
          primaryConn.options,
          primary.containerName,
          primaryRootPassword,
          `CREATE USER IF NOT EXISTS '${replUser}'@'%' IDENTIFIED BY '${replPassword}'; GRANT REPLICATION SLAVE ON *.* TO '${replUser}'@'%'; FLUSH PRIVILEGES;`,
        );

        await this.runMysql(
          targetConn.options,
          containerName,
          replicaRootPassword,
          // ponytail: GET_SOURCE_PUBLIC_KEY=1 — a réplica conecta pela rede real (não
          // localhost), e o plugin padrão caching_sha2_password recusa autenticar sem
          // canal seguro a menos que o cliente busque a chave pública do servidor.
          `CHANGE REPLICATION SOURCE TO SOURCE_HOST='${primaryHost}', SOURCE_PORT=${primary.port}, SOURCE_USER='${replUser}', SOURCE_PASSWORD='${replPassword}', SOURCE_AUTO_POSITION=1, GET_SOURCE_PUBLIC_KEY=1; START REPLICA;`,
        );

        // ponytail: read_only/super_read_only só depois da réplica no ar — a thread de
        // replicação continua podendo aplicar escritas mesmo com super_read_only=ON.
        await this.runMysql(targetConn.options, containerName, replicaRootPassword, 'SET GLOBAL super_read_only = ON;');
      } catch (err) {
        // ponytail: sem isso, um container/volume órfão do destino trava a próxima
        // tentativa com o mesmo nome (conflito de nome, ou volume reaproveitado com
        // senha antiga). Remove os dois — best-effort, o erro original é o que importa.
        await this.ssh
          .runCommand(targetConn.options, `sudo docker rm -f ${containerName}; sudo docker volume rm ${containerName}_data`, 30_000)
          .catch(() => undefined);
        throw err;
      }

      // 5. Valida sincronização.
      const statusRes = await this.runMysql(targetConn.options, containerName, replicaRootPassword, 'SHOW REPLICA STATUS', { vertical: true });
      const parsed = parseReplicaStatus(statusRes.stdout);
      const ioRunning = parsed['Replica_IO_Running'] === 'Yes';
      const sqlRunning = parsed['Replica_SQL_Running'] === 'Yes';
      const secondsBehind = Number(parsed['Seconds_Behind_Source'] ?? parsed['Seconds_Behind_Master'] ?? 'NaN');

      const replicaInstance = await this.prisma.databaseInstance.create({
        data: {
          serverId: dto.targetServerId,
          name: dto.name,
          containerName,
          port,
          mysqlServerId,
          role: 'REPLICA',
          status: ioRunning && sqlRunning ? 'ONLINE' : 'ERROR',
          databaseName: primary.databaseName,
          appUser: primary.appUser,
          appPasswordEnc: encryptCredential(appPassword),
          rootPasswordEnc: encryptCredential(replicaRootPassword),
          lastCheckedAt: new Date(),
        },
      });

      if (primary.role === 'STANDALONE') {
        await this.prisma.databaseInstance.update({ where: { id: primary.id }, data: { role: 'PRIMARY' } });
      }

      const replication = await this.prisma.databaseReplication.create({
        data: {
          primaryInstanceId: primary.id,
          replicaInstanceId: replicaInstance.id,
          replicationUser: replUser,
          replicationPasswordEnc: encryptCredential(replPassword),
          status: ioRunning && sqlRunning ? 'IN_SYNC' : 'ERROR',
          secondsBehind: Number.isFinite(secondsBehind) ? secondsBehind : null,
          lastError: parsed['Last_Error'] || parsed['Last_IO_Error'] || parsed['Last_SQL_Error'] || null,
          lastCheckedAt: new Date(),
        },
      });

      return {
        replication,
        replicaInstance: toPublicInstance(replicaInstance),
        warnings: [PORT_EXPOSURE_WARNING],
      };
    } finally {
      await fs.unlink(localDumpPath).catch(() => undefined);
    }
  }

  async replicationStatus(id: string) {
    const replication = await this.prisma.databaseReplication.findUnique({
      where: { id },
      include: { replicaInstance: true, primaryInstance: true },
    });
    if (!replication) throw new NotFoundException('Replicação não encontrada');
    if (replication.status === 'PROMOTED') return replication;

    const { options } = await this.servers.getServerWithConnectOptions(replication.replicaInstance.serverId);
    const rootPassword = decryptCredential(replication.replicaInstance.rootPasswordEnc);
    const statusRes = await this.runMysql(options, replication.replicaInstance.containerName, rootPassword, 'SHOW REPLICA STATUS', {
      vertical: true,
    });
    const parsed = parseReplicaStatus(statusRes.stdout);
    const ioRunning = parsed['Replica_IO_Running'] === 'Yes';
    const sqlRunning = parsed['Replica_SQL_Running'] === 'Yes';
    const secondsBehind = Number(parsed['Seconds_Behind_Source'] ?? parsed['Seconds_Behind_Master'] ?? 'NaN');
    const lastError = parsed['Last_Error'] || parsed['Last_IO_Error'] || parsed['Last_SQL_Error'] || null;

    let status: 'IN_SYNC' | 'DELAYED' | 'ERROR' = 'IN_SYNC';
    if (!ioRunning || !sqlRunning) status = 'ERROR';
    else if (Number.isFinite(secondsBehind) && secondsBehind > 10) status = 'DELAYED';

    return this.prisma.databaseReplication.update({
      where: { id },
      data: { status, secondsBehind: Number.isFinite(secondsBehind) ? secondsBehind : null, lastError, lastCheckedAt: new Date() },
      include: { replicaInstance: true, primaryInstance: true },
    });
  }

  async promoteReplica(id: string) {
    const replication = await this.prisma.databaseReplication.findUnique({
      where: { id },
      include: { replicaInstance: true, primaryInstance: true },
    });
    if (!replication) throw new NotFoundException('Replicação não encontrada');
    if (replication.status === 'PROMOTED') {
      throw new BadRequestException('Esta réplica já foi promovida');
    }

    const warnings: string[] = [];
    const replicaConn = await this.servers.getServerWithConnectOptions(replication.replicaInstance.serverId);
    const replicaRootPassword = decryptCredential(replication.replicaInstance.rootPasswordEnc);

    // Fencing best-effort: tenta travar o antigo primário para escrita antes de promover.
    // ponytail: não garante ausência de split-brain se o primário estiver
    // inacessível (fencing real precisaria de STONITH/API de energia do provedor).
    try {
      const primaryConn = await this.servers.getServerWithConnectOptions(replication.primaryInstance.serverId);
      const primaryRootPassword = decryptCredential(replication.primaryInstance.rootPasswordEnc);
      const fence = await this.runMysql(
        primaryConn.options,
        replication.primaryInstance.containerName,
        primaryRootPassword,
        'SET GLOBAL read_only=ON; SET GLOBAL super_read_only=ON;',
        { timeoutMs: 15_000 },
      );
      if (!fence.ok) {
        warnings.push('Não foi possível confirmar que o antigo primário parou de aceitar escritas. Verifique manualmente para evitar split-brain.');
      }
    } catch {
      warnings.push('Antigo primário inacessível — não foi possível confirmá-lo em modo somente leitura. Verifique manualmente para evitar split-brain.');
    }

    const promote = await this.runMysql(
      replicaConn.options,
      replication.replicaInstance.containerName,
      replicaRootPassword,
      'STOP REPLICA; RESET REPLICA ALL; SET GLOBAL read_only=OFF; SET GLOBAL super_read_only=OFF;',
      { timeoutMs: 30_000 },
    );
    if (!promote.ok) {
      throw new BadRequestException(`Falha ao promover a réplica: ${promote.stderr || promote.message}`);
    }

    await this.prisma.databaseInstance.update({ where: { id: replication.replicaInstanceId }, data: { role: 'PRIMARY' } });
    await this.prisma.databaseInstance.update({ where: { id: replication.primaryInstanceId }, data: { role: 'STANDALONE' } });
    const updated = await this.prisma.databaseReplication.update({ where: { id }, data: { status: 'PROMOTED' } });

    return { ok: true, replication: updated, warnings };
  }
}
