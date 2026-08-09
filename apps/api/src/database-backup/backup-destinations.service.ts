import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CreateBackupDestinationDto } from './dto/create-backup-destination.dto';

export interface ResolvedDestination {
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

/**
 * Conexões FTP/SFTP salvas pra onde backup de banco pode ser enviado —
 * mesmo padrão de credencial cifrada de `GitAccountsService`/`ServersService`.
 * A senha nunca volta em nenhuma resposta pública (`toPublic` a omite).
 */
@Injectable()
export class BackupDestinationsService {
  constructor(private readonly prisma: PrismaService) {}

  private toPublic(d: {
    id: string;
    label: string;
    protocol: string;
    host: string;
    port: number;
    username: string;
    remotePath: string;
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
        host: dto.host.trim(),
        port: dto.port,
        username: dto.username.trim(),
        credentialEnc: encryptCredential(dto.password),
        remotePath: dto.remotePath?.trim() || '/',
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
    };
  }
}
