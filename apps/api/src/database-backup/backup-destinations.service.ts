import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CreateBackupDestinationDto } from './dto/create-backup-destination.dto';

export interface ResolvedDestination {
  protocol: string;
  host: string | null;
  port: number | null;
  username: string;
  password: string;
  remotePath: string;
  bucket: string | null;
  region: string | null;
}

/**
 * Conexões FTP/SFTP/S3 salvas pra onde backup de banco pode ser enviado —
 * mesmo padrão de credencial cifrada de `GitAccountsService`/`ServersService`.
 * A senha/secret key nunca volta em nenhuma resposta pública (`toPublic` a omite).
 */
@Injectable()
export class BackupDestinationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublic(d: {
    id: string;
    label: string;
    protocol: string;
    host: string | null;
    port: number | null;
    username: string;
    remotePath: string;
    bucket: string | null;
    region: string | null;
    createdAt: Date;
  }) {
    return {
      id: d.id,
      label: d.label,
      protocol: d.protocol,
      host: d.host,
      port: d.port,
      username: d.username,
      remotePath: d.remotePath,
      bucket: d.bucket,
      region: d.region,
      createdAt: d.createdAt,
    };
  }

  async list() {
    const rows = await this.prisma.backupDestination.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((d) => this.toPublic(d));
  }

  async create(dto: CreateBackupDestinationDto) {
    const row = await this.prisma.backupDestination.create({
      data: {
        label: dto.label.trim(),
        protocol: dto.protocol,
        host: dto.host?.trim() || null,
        port: dto.protocol === 's3' ? null : dto.port,
        username: dto.username.trim(),
        credentialEnc: encryptCredential(dto.password),
        remotePath: dto.remotePath?.trim() || '/',
        bucket: dto.protocol === 's3' ? dto.bucket?.trim() : null,
        region: dto.protocol === 's3' ? dto.region?.trim() || 'us-east-1' : null,
      },
    });
    return this.toPublic(row);
  }

  async remove(id: string) {
    const row = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Destino de backup não encontrado');
    await this.prisma.backupDestination.delete({ where: { id } });
    return { ok: true };
  }

  /** Só pra uso interno (motor de backup) — nunca exposto por controller. */
  async resolveConnection(id: string): Promise<ResolvedDestination> {
    const row = await this.prisma.backupDestination.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Destino de backup não encontrado');
    return {
      protocol: row.protocol,
      host: row.host,
      port: row.port,
      username: row.username,
      password: decryptCredential(row.credentialEnc),
      remotePath: row.remotePath,
      bucket: row.bucket,
      region: row.region,
    };
  }
}
