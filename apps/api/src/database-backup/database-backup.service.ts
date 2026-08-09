import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { decryptCredential } from '../ssh/crypto.util';
import { shellSingleQuote } from '../database/mysql.util';
import { dumpCommand, isManagedDatabaseImage, backupFileName } from './database-backup.util';
import { uploadToDestination } from './backup-transfer.util';
import { BackupDestinationsService } from './backup-destinations.service';
import { SetBackupConfigDto } from './dto/set-backup-config.dto';

type LogFn = (line: string) => void;

@Injectable()
export class DatabaseBackupService {
  private readonly logger = new Logger(DatabaseBackupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly servers: ServersService,
    private readonly ssh: SshService,
    private readonly destinations: BackupDestinationsService,
  ) {}

  /** Todo ProjectService de banco (Postgres/MySQL/MariaDB) de todos os
   * projetos — o que alimenta a lista da aba "Bancos de Dados". */
  async listDatabases() {
    const services = await this.prisma.projectService.findMany({
      where: {
        OR: [
          { image: { contains: 'postgres', mode: 'insensitive' } },
          { image: { contains: 'mysql', mode: 'insensitive' } },
          { image: { contains: 'mariadb', mode: 'insensitive' } },
        ],
      },
      include: {
        application: { include: { server: { select: { id: true, name: true } } } },
        backupConfig: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return services
      .filter((s) => isManagedDatabaseImage(s.image))
      .map((s) => ({
        id: s.id,
        applicationId: s.applicationId,
        name: s.name,
        image: s.image,
        containerName: s.containerName,
        status: s.status,
        publishedPort: s.publishedPort,
        createdAt: s.createdAt,
        project: { id: s.application.id, name: s.application.name, slug: s.application.slug },
        server: s.application.server,
        hasSchedule: !!s.backupConfig?.scheduledAt,
      }));
  }

  async getConfig(projectServiceId: string) {
    const config = await this.prisma.databaseBackupConfig.findUnique({ where: { projectServiceId } });
    return config ?? { projectServiceId, scheduledAt: null, retentionDays: 14, destinationId: null };
  }

  async setConfig(projectServiceId: string, dto: SetBackupConfigDto) {
    const service = await this.prisma.projectService.findUnique({ where: { id: projectServiceId } });
    if (!service) throw new NotFoundException('Banco não encontrado');

    return this.prisma.databaseBackupConfig.upsert({
      where: { projectServiceId },
      create: {
        projectServiceId,
        scheduledAt: dto.scheduledAt ?? null,
        retentionDays: dto.retentionDays ?? 14,
        destinationId: dto.destinationId ?? null,
      },
      update: {
        scheduledAt: dto.scheduledAt === undefined ? undefined : dto.scheduledAt,
        retentionDays: dto.retentionDays ?? undefined,
        destinationId: dto.destinationId === undefined ? undefined : dto.destinationId,
      },
    });
  }

  listRuns(projectServiceId: string) {
    return this.prisma.databaseBackupRun.findMany({
      where: { projectServiceId },
      orderBy: { startedAt: 'desc' },
      take: 30,
    });
  }

  /**
   * Dispara o backup de um banco: dump dentro do container (via docker exec,
   * mesma técnica de `service-db-import` invertida), comprimido, baixado pro
   * disco da API e — se houver destino configurado — reenviado por SFTP/FTP.
   * O dump nunca sai direto do servidor do banco pro destino: passa pela API
   * como intermediário, igual ao backup do próprio Velix (`BackupService`).
   */
  async run(projectServiceId: string, trigger: 'scheduled' | 'manual', onLog?: LogFn): Promise<{ ok: boolean; error?: string }> {
    const service = await this.prisma.projectService.findUnique({
      where: { id: projectServiceId },
      include: { application: true, deployment: true },
    });
    if (!service) throw new NotFoundException('Banco não encontrado');
    if (!isManagedDatabaseImage(service.image)) {
      throw new BadRequestException('Backup não é suportado para este tipo de serviço');
    }
    if (!service.deployment.secretsEnc) {
      throw new BadRequestException('Não achei a senha deste banco — a implantação não gerou segredos.');
    }

    const secretsMap = JSON.parse(decryptCredential(service.deployment.secretsEnc)) as Record<string, string>;
    const secretKey = service.image.toLowerCase().includes('postgres') ? 'POSTGRES_PASSWORD' : 'ROOT_PASSWORD';
    const password = secretsMap[secretKey];
    if (!password) throw new BadRequestException(`Segredo "${secretKey}" não encontrado nesta implantação.`);

    const variablesMap = service.deployment.variablesJson ? (JSON.parse(service.deployment.variablesJson) as Record<string, string>) : {};
    const dbName = variablesMap.DATABASE_NAME || 'app';

    const dump = dumpCommand(service.image, password, dbName);
    if (!dump) throw new BadRequestException('Backup não é suportado para este tipo de serviço');

    const fileName = backupFileName(service.name);
    const config = await this.getConfig(projectServiceId);

    const run = await this.prisma.databaseBackupRun.create({
      data: { projectServiceId, trigger, status: 'RUNNING', fileName },
    });

    const { options } = await this.servers.getServerWithConnectOptions(service.application.serverId);
    const remoteTmp = `/tmp/velix-backup-${randomUUID()}.sql.gz`;
    const localTmp = join(tmpdir(), `velix-backup-${randomUUID()}.sql.gz`);

    try {
      onLog?.('Gerando o dump dentro do container...\n');
      const dumpResult = await this.ssh.runCommand(
        options,
        `sudo docker exec ${dump.execFlags} ${shellSingleQuote(service.containerName)} ${dump.command} | gzip > ${remoteTmp} && chmod 600 ${remoteTmp}`,
        600_000,
        onLog && ((chunk) => onLog(chunk)),
      );
      if (!dumpResult.ok) throw new Error(dumpResult.stderr || dumpResult.message || 'Falha ao gerar o dump');

      const statResult = await this.ssh.runCommand(options, `stat -c%s ${remoteTmp}`, 15_000);
      const sizeBytes = Number(statResult.stdout.trim()) || null;

      let uploadedRemote = false;
      if (config.destinationId) {
        onLog?.('Baixando o dump pro Velix...\n');
        const download = await this.ssh.downloadFile(options, remoteTmp, localTmp, 300_000);
        if (!download.ok) throw new Error(download.message || 'Falha ao baixar o dump do servidor');

        onLog?.('Enviando pro destino configurado...\n');
        const destination = await this.destinations.resolveConnection(config.destinationId);
        await uploadToDestination(this.ssh, destination, localTmp, fileName);
        uploadedRemote = true;
      }

      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), sizeBytes, uploadedRemote },
      });
      onLog?.('Backup concluído.\n');
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha no backup';
      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'ERROR', finishedAt: new Date(), error: message.slice(0, 500) },
      });
      this.logger.error(`Backup de ${service.name} (${projectServiceId}) falhou: ${message}`);
      return { ok: false, error: message };
    } finally {
      await this.ssh.runCommand(options, `sudo rm -f ${remoteTmp}`, 15_000).catch(() => undefined);
      await unlink(localTmp).catch(() => undefined);
    }
  }

  /** Varre a cada hora, na hora cheia — cobre qualquer "HH:mm" configurado
   * cujo HH bata com a hora atual (a granularidade de minuto exata não é
   * garantida, mas "todo dia por volta desse horário" já atende o pedido;
   * refinar pra minuto exato é trivial depois se fizer falta). */
  @Cron('0 * * * *')
  async scheduledSweep() {
    const currentHour = new Date().getHours().toString().padStart(2, '0');
    const configs = await this.prisma.databaseBackupConfig.findMany({
      where: { scheduledAt: { startsWith: `${currentHour}:` } },
    });
    for (const config of configs) {
      await this.run(config.projectServiceId, 'scheduled').catch((err) =>
        this.logger.error(`Backup agendado de ${config.projectServiceId} falhou: ${err instanceof Error ? err.message : err}`),
      );
    }
  }
}
