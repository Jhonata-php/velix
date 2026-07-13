import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { encryptCredential } from '../ssh/crypto.util';
import { buildConnectOptions } from '../ssh/connect-options.util';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { generateSshKeyPair } from '../ssh/keygen.util';
import { CreateServerDto } from './dto/create-server.dto';
import { parseAptUpgradable, parseDnfUpgradable, parseSecurityPackageNames } from './updates.util';
import { METRICS_COMMAND, parseMetrics } from './metrics.util';

type LogFn = (line: string) => void;

function toPublic<T extends { credentialEnc: string }>(server: T) {
  const { credentialEnc: _drop, ...rest } = server;
  return rest;
}

@Injectable()
export class ServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly cloudflare: CloudflareService,
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

  generateSshKey() {
    const { publicKey, privateKey } = generateSshKeyPair();
    const command = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${publicKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
    return { publicKey, privateKey, command };
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

  /** Usado por outros módulos (ex.: database) que precisam executar comandos no servidor. */
  async getServerWithConnectOptions(id: string) {
    const server = await this.getRawServer(id);
    return { server, options: this.toConnectOptions(server) };
  }

  private toConnectOptions(server: Awaited<ReturnType<ServersService['getRawServer']>>) {
    try {
      return buildConnectOptions(server);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Falha ao montar credenciais SSH');
    }
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

  /** Uma única conexão SSH: testa disponibilidade e já coleta uptime/memória/disco. */
  async collectMetrics(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const result = await this.ssh.runCommand(options, METRICS_COMMAND, 15_000);

    if (!result.ok) {
      await this.prisma.server.update({ where: { id }, data: { status: 'OFFLINE', lastCheckedAt: new Date() } });
      return { online: false, metrics: null };
    }

    const metrics = parseMetrics(result.stdout);
    await this.prisma.server.update({
      where: { id },
      data: { status: 'ONLINE', metrics: metrics as object, metricsCheckedAt: new Date(), lastCheckedAt: new Date() },
    });
    return { online: true, metrics };
  }

  async reboot(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    // ponytail: dispara em subshell destacado (`disown`) pra nosso comando
    // retornar antes do servidor cair — senão o canal SSH morre no meio e o
    // resultado fica ambíguo (sucesso indistinguível de erro).
    const result = await this.ssh.runCommand(options, 'nohup sudo sh -c "sleep 1 && reboot" >/dev/null 2>&1 & disown; echo sent', 10_000);
    if (!result.ok) {
      throw new BadRequestException(`Falha ao enviar comando de reboot: ${result.stderr || result.message}`);
    }
    return { ok: true, message: 'Comando de reboot enviado — o servidor deve voltar em alguns instantes.' };
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

  /** Garante curl + ca-certificates antes de instalar Docker/EasyPanel — imagens mínimas costumam vir sem isso. */
  private async ensurePrerequisites(options: SshConnectOptions, onLog?: LogFn) {
    const hasCurl = await this.ssh.runCommand(options, 'command -v curl', 10_000);
    if (hasCurl.ok) return;

    onLog?.('curl não encontrado — instalando pré-requisitos...\n');
    const packageManager = await this.detectPackageManager(options);
    const installCmd =
      packageManager === 'apt'
        ? 'sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates'
        : packageManager === 'dnf'
          ? 'sudo dnf install -y curl ca-certificates'
          : packageManager === 'yum'
            ? 'sudo yum install -y curl ca-certificates'
            : null;

    if (!installCmd) {
      throw new BadRequestException('curl não está instalado e o gerenciador de pacotes do servidor não foi reconhecido (apt/dnf/yum) para instalá-lo automaticamente');
    }

    const result = await this.ssh.runCommand(options, installCmd, 120_000, onLog && ((chunk) => onLog(chunk)));
    if (!result.ok) {
      throw new BadRequestException(`Falha ao instalar pré-requisitos (curl/ca-certificates): ${result.stderr || result.message}`);
    }
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

  async installUpdates(id: string, securityOnly: boolean, onLog?: LogFn) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const packageManager = server.packageManager ?? (await this.detectPackageManager(options));
    const stream: LogFn | undefined = onLog && ((chunk) => onLog(chunk));

    if (packageManager === 'apt') {
      if (securityOnly) {
        const listRes = await this.ssh.runCommand(options, 'apt list --upgradable 2>/dev/null | tail -n +2', 60_000);
        const securityPkgs = parseAptUpgradable(listRes.stdout).filter((p) => p.security);
        if (securityPkgs.length === 0) {
          return { ok: true, stdout: 'Nenhuma atualização de segurança pendente.', stderr: '', code: 0 };
        }
        const names = securityPkgs.map((p) => p.name).join(' ');
        return this.ssh.runCommand(options, `sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${names}`, 600_000, stream);
      }
      return this.ssh.runCommand(options, 'sudo DEBIAN_FRONTEND=noninteractive apt-get -y upgrade', 600_000, stream);
    }

    if (packageManager === 'dnf' || packageManager === 'yum') {
      const flag = securityOnly ? '--security' : '';
      return this.ssh.runCommand(options, `sudo ${packageManager} -y update ${flag}`.trim(), 600_000, stream);
    }

    throw new BadRequestException('Gerenciador de pacotes não identificado. Rode "Verificar atualizações" primeiro.');
  }

  async installDocker(id: string, onLog?: LogFn) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    await this.ensurePrerequisites(options, onLog);

    // ponytail: baixa e executa em passos separados de propósito. Com
    // `curl ... | sudo sh` direto, se o curl falhar (rede, DNS) o `sh` recebe
    // stdin vazio e sai com código 0 — o pipeline "dá certo" sem instalar nada.
    onLog?.('Baixando instalador do Docker...\n');
    const download = await this.ssh.runCommand(options, 'curl -fsSL https://get.docker.com -o /tmp/velix-get-docker.sh', 60_000);
    if (!download.ok) {
      return { ok: false, output: `Falha ao baixar o instalador do Docker: ${download.stderr || download.message}`, version: null };
    }

    onLog?.('Executando instalador (isso pode levar alguns minutos)...\n');
    const install = await this.ssh.runCommand(
      options,
      'sudo sh /tmp/velix-get-docker.sh; rm -f /tmp/velix-get-docker.sh',
      600_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    if (!install.ok) {
      return { ok: false, output: install.stdout + install.stderr, version: null };
    }

    const installed = await this.ssh.runCommand(options, 'command -v docker', 10_000);
    if (!installed.ok) {
      return { ok: false, output: `${install.stdout}\nO instalador rodou mas o comando "docker" não ficou disponível.`, version: null };
    }

    await this.ssh.runCommand(options, 'sudo systemctl enable --now docker', 30_000);
    onLog?.('Validando com container de teste (hello-world)...\n');
    const verify = await this.ssh.runCommand(options, 'sudo docker run --rm hello-world', 60_000, onLog && ((chunk) => onLog(chunk)));
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
    return { installed: true as const, version: versionRes.stdout.trim(), containers: this.parseContainers(psRes.stdout) };
  }

  private parseContainers(output: string) {
    return output
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, image, status, names] = line.split('|');
        return { id, image, status, names };
      });
  }

  private async upsertCloudflareRecord(domain: string, ip: string) {
    const zones = await this.cloudflare.listZones();
    const zone = zones
      .filter((z) => domain === z.name || domain.endsWith(`.${z.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!zone) {
      throw new Error(`Nenhuma zona Cloudflare encontrada para o domínio ${domain}`);
    }
    const records = await this.cloudflare.listRecords(zone.id);
    const existing = records.find((r) => r.name === domain && r.type === 'A');
    if (existing) {
      await this.cloudflare.updateRecord(zone.id, existing.id, { content: ip });
    } else {
      await this.cloudflare.createRecord(zone.id, { type: 'A', name: domain, content: ip, proxied: false });
    }
  }

  async installEasyPanel(id: string, opts: { domain?: string; email: string; createDnsRecord?: boolean }, onLog?: LogFn) {
    const server = await this.getRawServer(id);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes do EasyPanel');
    }
    const options = this.toConnectOptions(server);
    await this.ensurePrerequisites(options, onLog);
    const warnings: string[] = [];

    if (opts.domain && opts.createDnsRecord) {
      if (!server.publicIp) {
        warnings.push('Servidor sem IP público cadastrado — DNS não foi configurado automaticamente.');
      } else {
        try {
          onLog?.(`Configurando DNS na Cloudflare para ${opts.domain}...\n`);
          await this.upsertCloudflareRecord(opts.domain, server.publicIp);
        } catch (err) {
          warnings.push(`Falha ao configurar DNS na Cloudflare: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // ponytail: mesmo motivo do installDocker — download e execução separados
    // pra não mascarar falha do curl atrás de um `sh` que "deu certo" com stdin vazio.
    onLog?.('Baixando instalador do EasyPanel...\n');
    const download = await this.ssh.runCommand(options, 'curl -fsSL https://get.easypanel.io -o /tmp/velix-get-easypanel.sh', 60_000);
    if (!download.ok) {
      return { ok: false, output: `Falha ao baixar o instalador do EasyPanel: ${download.stderr || download.message}`, url: null, warnings };
    }
    onLog?.('Executando instalador (isso pode levar alguns minutos)...\n');
    const install = await this.ssh.runCommand(
      options,
      'sudo sh /tmp/velix-get-easypanel.sh; rm -f /tmp/velix-get-easypanel.sh',
      600_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    if (!install.ok) {
      return { ok: false, output: install.stdout + install.stderr, url: null, warnings };
    }

    // dá um tempo para o container subir antes de validar
    onLog?.('Aguardando o container subir...\n');
    await new Promise((r) => setTimeout(r, 5000));
    const check = await this.ssh.runCommand(options, "sudo docker ps --filter name=easypanel --format '{{.Status}}'", 15_000);
    const running = check.stdout.toLowerCase().includes('up');

    const url = opts.domain ? `https://${opts.domain}` : `http://${server.publicIp ?? server.hostname}:3000`;

    await this.prisma.server.update({
      where: { id },
      data: { easypanelInstalled: running, easypanelUrl: running ? url : null },
    });

    return { ok: running, output: install.stdout + check.stdout, url: running ? url : null, warnings };
  }

  async easypanelStatus(id: string) {
    const server = await this.getRawServer(id);
    if (!server.easypanelInstalled) {
      return { installed: false as const };
    }
    const options = this.toConnectOptions(server);
    const psRes = await this.ssh.runCommand(
      options,
      "sudo docker ps -a --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}'",
      15_000,
    );
    return { installed: true as const, url: server.easypanelUrl, containers: this.parseContainers(psRes.stdout) };
  }
}
