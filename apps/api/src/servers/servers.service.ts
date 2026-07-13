import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { CreateServerDto } from './dto/create-server.dto';
import { parseAptUpgradable, parseDnfUpgradable, parseSecurityPackageNames } from './updates.util';

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

  private async getRawServer(id: string) {
    const server = await this.prisma.server.findUnique({ where: { id } });
    if (!server) throw new NotFoundException('Servidor não encontrado');
    return server;
  }

  private toConnectOptions(server: Awaited<ReturnType<ServersService['getRawServer']>>): SshConnectOptions {
    const host = server.publicIp || server.privateIp || server.hostname;
    if (!host) throw new BadRequestException('Servidor não possui IP ou hostname cadastrado');
    const secret = decryptCredential(server.credentialEnc);
    return {
      host,
      port: server.sshPort,
      username: server.sshUser,
      password: server.authMethod === 'PASSWORD' ? secret : undefined,
      privateKey: server.authMethod === 'PRIVATE_KEY' ? secret : undefined,
    };
  }

  async testConnection(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const result = await this.ssh.testConnection(options);

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

  private async detectPackageManager(options: SshConnectOptions): Promise<'apt' | 'dnf' | 'yum' | 'unknown'> {
    const result = await this.ssh.runCommand(
      options,
      "command -v apt-get >/dev/null 2>&1 && echo apt || (command -v dnf >/dev/null 2>&1 && echo dnf || (command -v yum >/dev/null 2>&1 && echo yum || echo unknown))",
      15_000,
    );
    const pm = result.stdout.trim();
    return pm === 'apt' || pm === 'dnf' || pm === 'yum' ? pm : 'unknown';
  }

  async checkUpdates(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const packageManager = await this.detectPackageManager(options);

    if (packageManager === 'unknown') {
      throw new BadRequestException('Gerenciador de pacotes não identificado (suporta apt, dnf e yum)');
    }
    await this.prisma.server.update({ where: { id }, data: { packageManager } });

    if (packageManager === 'apt') {
      const listRes = await this.ssh.runCommand(
        options,
        'sudo apt-get update -qq >/dev/null 2>&1; apt list --upgradable 2>/dev/null | tail -n +2',
        60_000,
      );
      const packages = parseAptUpgradable(listRes.stdout);
      return {
        packageManager,
        total: packages.length,
        security: packages.filter((p) => p.security).length,
        packages,
      };
    }

    // dnf / yum
    const bin = packageManager;
    const securityRes = await this.ssh.runCommand(options, `sudo ${bin} updateinfo list security -q 2>/dev/null`, 60_000);
    const securityNames = parseSecurityPackageNames(securityRes.stdout);
    const listRes = await this.ssh.runCommand(options, `sudo ${bin} check-update -q 2>/dev/null`, 60_000);
    const packages = parseDnfUpgradable(listRes.stdout, securityNames);
    return {
      packageManager,
      total: packages.length,
      security: packages.filter((p) => p.security).length,
      packages,
    };
  }

  async installUpdates(id: string, securityOnly: boolean) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const packageManager = server.packageManager ?? (await this.detectPackageManager(options));

    if (packageManager === 'apt') {
      if (securityOnly) {
        const listRes = await this.ssh.runCommand(options, 'apt list --upgradable 2>/dev/null | tail -n +2', 60_000);
        const securityPkgs = parseAptUpgradable(listRes.stdout).filter((p) => p.security);
        if (securityPkgs.length === 0) {
          return { ok: true, stdout: 'Nenhuma atualização de segurança pendente.', stderr: '', code: 0 };
        }
        const names = securityPkgs.map((p) => p.name).join(' ');
        return this.ssh.runCommand(options, `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${names}`, 600_000);
      }
      return this.ssh.runCommand(options, 'sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade', 600_000);
    }

    if (packageManager === 'dnf' || packageManager === 'yum') {
      const flag = securityOnly ? '--security' : '';
      return this.ssh.runCommand(options, `sudo ${packageManager} -y update ${flag}`.trim(), 600_000);
    }

    throw new BadRequestException('Gerenciador de pacotes não identificado. Rode "Verificar atualizações" primeiro.');
  }

  async installDocker(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);

    const install = await this.ssh.runCommand(options, 'curl -fsSL https://get.docker.com | sudo sh', 600_000);
    if (!install.ok) {
      return { ok: false, output: install.stdout + install.stderr, version: null };
    }

    await this.ssh.runCommand(options, 'sudo systemctl enable --now docker', 30_000);
    const verify = await this.ssh.runCommand(options, 'sudo docker run --rm hello-world', 60_000);
    const versionRes = await this.ssh.runCommand(options, "sudo docker version --format '{{.Server.Version}}'", 15_000);
    const version = versionRes.stdout.trim() || null;

    await this.prisma.server.update({
      where: { id },
      data: { dockerInstalled: verify.ok, dockerVersion: version },
    });

    return { ok: verify.ok, output: install.stdout + verify.stdout + verify.stderr, version };
  }

  async dockerStatus(id: string) {
    const server = await this.getRawServer(id);
    if (!server.dockerInstalled) {
      return { installed: false as const };
    }
    const options = this.toConnectOptions(server);
    const versionRes = await this.ssh.runCommand(options, "sudo docker version --format '{{.Server.Version}}'", 15_000);
    if (!versionRes.ok) {
      return { installed: false as const };
    }
    const psRes = await this.ssh.runCommand(
      options,
      "sudo docker ps -a --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}'",
      15_000,
    );
    const containers = psRes.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, image, status, names] = line.split('|');
        return { id, image, status, names };
      });

    return { installed: true as const, version: versionRes.stdout.trim(), containers };
  }
}
