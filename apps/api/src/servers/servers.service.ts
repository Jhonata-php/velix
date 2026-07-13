import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService } from '../ssh/ssh.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CreateServerDto } from './dto/create-server.dto';

function toPublic<T extends { credentialEnc: string }>(server: T) {
  const { credentialEnc: _drop, ...rest } = server;
  return rest;
}

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
  ) {}

  async create(dto: CreateServerDto) {
    const secret = dto.authMethod === 'PASSWORD' ? dto.password : dto.privateKey;
    if (!secret) {
      throw new BadRequestException('Informe a senha ou a chave privada para o método de autenticação escolhido');
    }
    const server = await this.prisma.server.create({
      data: {
        name: dto.name,
        description: dto.description,
        publicIp: dto.publicIp,
        privateIp: dto.privateIp,
        hostname: dto.hostname,
        sshPort: dto.sshPort,
        sshUser: dto.sshUser,
        authMethod: dto.authMethod,
        credentialEnc: encryptCredential(secret),
        environment: dto.environment,
        tags: dto.tags ?? [],
      },
    });
    return toPublic(server);
  }

  async findAll() {
    const servers = await this.prisma.server.findMany({ orderBy: { createdAt: 'desc' } });
    return servers.map(toPublic);
  }

  async findOne(id: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Servidor não encontrado');
    return toPublic(server);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.server.delete({ where: { id } });
    return { ok: true };
  }

  async testConnection(id: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Servidor não encontrado');

    const host = server.publicIp || server.privateIp || server.hostname;
    if (!host) throw new BadRequestException('Servidor não possui IP ou hostname cadastrado');

    const secret = decryptCredential(server.credentialEnc);
    const result = await this.ssh.testConnection({
      host,
      port: server.sshPort,
      username: server.sshUser,
      password: server.authMethod === 'PASSWORD' ? secret : undefined,
      privateKey: server.authMethod === 'PRIVATE_KEY' ? secret : undefined,
    });

    const osName = result.osRelease?.match(/^ID=(.*)$/m)?.[1]?.replace(/"/g, '');
    const osVersion = result.osRelease?.match(/^VERSION_ID=(.*)$/m)?.[1]?.replace(/"/g, '');

    await this.prisma.server.update({
      where: { id },
      data: {
        status: result.ok ? 'ONLINE' : 'ERROR',
        lastCheckedAt: new Date(),
        ...(result.ok ? { osName, osVersion } : {}),
      },
    });

    return result;
  }
}
