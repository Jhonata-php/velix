import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { appDir } from '../applications/applications.util';
import { ServersService } from '../servers/servers.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { decryptCredential } from '../ssh/crypto.util';
import { dumpCommand, dumpPipelineCommand, isManagedDatabaseImage, backupFileName, moveToBackupDirCommand, pruneBackupsCommand } from './database-backup.util';
import { uploadToDestination } from './backup-transfer.util';
import { BackupDestinationsService } from './backup-destinations.service';
import { SetBackupConfigDto } from './dto/set-backup-config.dto';

type LogFn = (line: string) => void;

/** Mesma ideia de `redactToken` em `applications/git-source.util.ts`: alguns
 * modos de falha do shell/sudo ecoam parte da linha de comando ofensiva no
 * stderr, e o comando do dump embute a senha em texto puro (`PGPASSWORD=`/
 * `-p<senha>`). Aplicado em toda mensagem de erro persistida como
 * `DatabaseBackupRun.error`. */
function redactSecret(text: string, secret?: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}

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

    // A partir daqui a run já é criada — o `DatabaseBackupRun.projectServiceId`
    // tem FK pra ProjectService, então o lookup acima não dá pra adiar, mas
    // toda falha de configuração seguinte (imagem não suportada, segredo
    // ausente, dump, upload) fica registrada nesta run em vez de estourar
    // sem deixar rastro pro `scheduledSweep` (era o bug: um agendamento mal
    // configurado falhava silenciosamente toda hora, pra sempre).
    const fileName = backupFileName(service.name);
    const run = await this.prisma.databaseBackupRun.create({
      data: { projectServiceId, trigger, status: 'RUNNING', fileName },
    });

    let password: string | undefined;
    let sshOptions: SshConnectOptions | undefined;
    let remoteTmp: string | undefined;
    let localTmp: string | undefined;

    try {
      if (!isManagedDatabaseImage(service.image)) {
        throw new BadRequestException('Backup não é suportado para este tipo de serviço');
      }
      if (!service.deployment.secretsEnc) {
        throw new BadRequestException('Não achei a senha deste banco — a implantação não gerou segredos.');
      }

      const secretsMap = JSON.parse(decryptCredential(service.deployment.secretsEnc)) as Record<string, string>;
      const secretKey = service.image.toLowerCase().includes('postgres') ? 'POSTGRES_PASSWORD' : 'ROOT_PASSWORD';
      password = secretsMap[secretKey];
      if (!password) throw new BadRequestException(`Segredo "${secretKey}" não encontrado nesta implantação.`);

      const variablesMap = service.deployment.variablesJson ? (JSON.parse(service.deployment.variablesJson) as Record<string, string>) : {};
      const dbName = variablesMap.DATABASE_NAME || 'app';

      const dump = dumpCommand(service.image, password, dbName);
      if (!dump) throw new BadRequestException('Backup não é suportado para este tipo de serviço');

      const config = await this.getConfig(projectServiceId);

      const { options } = await this.servers.getServerWithConnectOptions(service.application.serverId);
      sshOptions = options;
      remoteTmp = `/tmp/velix-backup-${randomUUID()}.sql.gz`;
      localTmp = join(tmpdir(), `velix-backup-${randomUUID()}.sql.gz`);

      onLog?.('Gerando o dump dentro do container...\n');
      const dumpResult = await this.ssh.runCommand(
        options,
        dumpPipelineCommand(dump.execFlags, service.containerName, dump.command, remoteTmp),
        600_000,
        onLog && ((chunk) => onLog(redactSecret(chunk, password))),
      );
      if (!dumpResult.ok) throw new Error(dumpResult.stderr || dumpResult.message || 'Falha ao gerar o dump');

      const statResult = await this.ssh.runCommand(options, `stat -c%s ${remoteTmp}`, 15_000);
      const sizeBytes = Number(statResult.stdout.trim()) || null;

      // Pasta compartilhada por todos os bancos deste projeto (spec 2.3) — a
      // poda abaixo é restrita ao prefixo deste serviço (pruneBackupsCommand),
      // então não apaga backup de outro banco no mesmo diretório.
      const backupDir = `${appDir(service.application.slug)}/backups`;

      let uploadedRemote = false;
      if (config.destinationId) {
        onLog?.('Baixando o dump pro Velix...\n');
        const download = await this.ssh.downloadFile(options, remoteTmp, localTmp, 300_000);
        if (!download.ok) throw new Error(download.message || 'Falha ao baixar o dump do servidor');

        onLog?.('Enviando pro destino configurado...\n');
        const destination = await this.destinations.resolveConnection(config.destinationId);
        await uploadToDestination(this.ssh, destination, localTmp, fileName);
        uploadedRemote = true;
      } else {
        // Sem destino: o dump fica no próprio servidor do banco (spec 2.3),
        // não é jogado fora. Move pra fora do /tmp — o `finally` só limpa o
        // que ainda estiver lá, então depois do `mv` o `rm -f` dele vira no-op.
        onLog?.('Sem destino configurado — guardando o dump no próprio servidor...\n');
        const moveResult = await this.ssh.runCommand(options, moveToBackupDirCommand(backupDir, remoteTmp, fileName), 30_000);
        if (!moveResult.ok) throw new Error(moveResult.stderr || moveResult.message || 'Falha ao guardar o dump no servidor');
      }

      // Poda dos backups locais deste serviço — roda nos dois ramos: mesmo com
      // destino configurado, arquivos locais acumulados de antes (quando ainda
      // não havia destino) continuam sendo limpos. Fire-and-forget: falha na
      // poda não pode virar ERROR numa run que já terminou com sucesso.
      this.ssh
        .runCommand(options, pruneBackupsCommand(backupDir, service.name, config.retentionDays), 30_000)
        .then((pruneResult) => {
          if (!pruneResult.ok) {
            this.logger.warn(`Poda de backups locais de ${service.name} (${projectServiceId}) falhou: ${pruneResult.stderr || pruneResult.message}`);
          }
        })
        .catch((err) => this.logger.warn(`Poda de backups locais de ${service.name} (${projectServiceId}) falhou: ${err instanceof Error ? err.message : err}`));

      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), sizeBytes, uploadedRemote },
      });
      onLog?.('Backup concluído.\n');
      return { ok: true };
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : 'Falha no backup';
      // A senha em texto puro pode ter vazado pro stderr do docker/ssh em
      // alguns modos de falha do shell — nunca persistir sem redigir.
      const message = redactSecret(rawMessage, password).slice(0, 500);
      await this.prisma.databaseBackupRun.update({
        where: { id: run.id },
        data: { status: 'ERROR', finishedAt: new Date(), error: message },
      });
      this.logger.error(`Backup de ${service.name} (${projectServiceId}) falhou: ${message}`);
      return { ok: false, error: message };
    } finally {
      if (sshOptions && remoteTmp) {
        await this.ssh.runCommand(sshOptions, `sudo rm -f ${remoteTmp}`, 15_000).catch(() => undefined);
      }
      if (localTmp) {
        await unlink(localTmp).catch(() => undefined);
      }
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
