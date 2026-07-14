import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { encryptCredential } from '../ssh/crypto.util';
import { buildConnectOptions } from '../ssh/connect-options.util';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { generateSshKeyPair } from '../ssh/keygen.util';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
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

  async update(id: string, dto: UpdateServerDto) {
    await this.findOne(id);
    const secret = dto.authMethod === 'PASSWORD' ? dto.password : dto.authMethod === 'PRIVATE_KEY' ? dto.privateKey : undefined;

    const server = await this.prisma.server.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.publicIp !== undefined ? { publicIp: dto.publicIp } : {}),
        ...(dto.privateIp !== undefined ? { privateIp: dto.privateIp } : {}),
        ...(dto.hostname !== undefined ? { hostname: dto.hostname } : {}),
        ...(dto.sshPort !== undefined ? { sshPort: dto.sshPort } : {}),
        ...(dto.sshUser !== undefined ? { sshUser: dto.sshUser } : {}),
        ...(dto.authMethod !== undefined ? { authMethod: dto.authMethod } : {}),
        ...(secret ? { credentialEnc: encryptCredential(secret) } : {}),
      },
    });
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

    await this.prisma.serverMetricSample.create({
      data: {
        serverId: id,
        loadAvg1: metrics.loadAvg?.[0] ?? null,
        memUsedMb: metrics.memUsedMb,
        memTotalMb: metrics.memTotalMb,
        diskPercent: metrics.diskPercent ? Number(metrics.diskPercent.replace('%', '')) : null,
      },
    });
    // ponytail: poda direto aqui em vez de um job separado — cada coleta já é
    // uma chance barata de limpar o que passou dos 7 dias de retenção.
    await this.prisma.serverMetricSample.deleteMany({
      where: { serverId: id, capturedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    });

    return { online: true, metrics };
  }

  async metricsHistory(id: string, hours: number) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const samples = await this.prisma.serverMetricSample.findMany({
      where: { serverId: id, capturedAt: { gte: since } },
      orderBy: { capturedAt: 'asc' },
      select: { loadAvg1: true, memUsedMb: true, memTotalMb: true, diskPercent: true, capturedAt: true },
    });
    return samples;
  }

  async getMirror(sourceServerId: string) {
    const mirror = await this.prisma.serverMirror.findUnique({
      where: { sourceServerId },
      include: { targetServer: { select: { id: true, name: true } } },
    });
    return mirror ? { targetServerId: mirror.targetServerId, targetServerName: mirror.targetServer.name } : null;
  }

  async setMirror(sourceServerId: string, targetServerId: string) {
    if (sourceServerId === targetServerId) {
      throw new BadRequestException('O servidor de destino do espelhamento precisa ser diferente da origem');
    }
    await this.getRawServer(targetServerId);
    await this.prisma.serverMirror.upsert({
      where: { sourceServerId },
      create: { sourceServerId, targetServerId },
      update: { targetServerId },
    });
    return { ok: true };
  }

  async clearMirror(sourceServerId: string) {
    await this.prisma.serverMirror.deleteMany({ where: { sourceServerId } });
    return { ok: true };
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

  async startContainer(id: string, containerId: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const result = await this.ssh.runCommand(options, `sudo docker start ${containerId}`, 30_000);
    if (!result.ok) throw new BadRequestException(`Falha ao iniciar container: ${result.stderr || result.message}`);
    return { ok: true };
  }

  async stopContainer(id: string, containerId: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const result = await this.ssh.runCommand(options, `sudo docker stop ${containerId}`, 30_000);
    if (!result.ok) throw new BadRequestException(`Falha ao parar container: ${result.stderr || result.message}`);
    return { ok: true };
  }

  async removeContainer(id: string, containerId: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const result = await this.ssh.runCommand(options, `sudo docker rm -f ${containerId}`, 30_000);
    if (!result.ok) throw new BadRequestException(`Falha ao remover container: ${result.stderr || result.message}`);
    return { ok: true };
  }

  async uninstallDocker(id: string, onLog?: LogFn) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const packageManager = server.packageManager ?? (await this.detectPackageManager(options));
    const stream: LogFn | undefined = onLog && ((chunk) => onLog(chunk));

    onLog?.('Parando containers em execução...\n');
    await this.ssh.runCommand(options, 'sudo docker ps -aq | xargs -r sudo docker rm -f', 60_000);

    const purgeCmd =
      packageManager === 'apt'
        ? 'sudo DEBIAN_FRONTEND=noninteractive apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && sudo apt-get autoremove -y'
        : packageManager === 'dnf'
          ? 'sudo dnf remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
          : packageManager === 'yum'
            ? 'sudo yum remove -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin'
            : null;

    if (!purgeCmd) {
      throw new BadRequestException('Gerenciador de pacotes não identificado — não é possível desinstalar automaticamente');
    }

    onLog?.('Removendo pacotes do Docker...\n');
    const remove = await this.ssh.runCommand(options, purgeCmd, 180_000, stream);
    if (!remove.ok) {
      throw new BadRequestException(`Falha ao remover pacotes do Docker: ${remove.stderr || remove.message}`);
    }

    onLog?.('Removendo dados residuais (/var/lib/docker, /etc/docker)...\n');
    await this.ssh.runCommand(options, 'sudo rm -rf /var/lib/docker /etc/docker', 30_000);

    await this.prisma.server.update({
      where: { id },
      data: { dockerInstalled: false, dockerVersion: null, easypanelInstalled: false, easypanelUrl: null },
    });

    return { ok: true };
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

  async installEasyPanel(id: string, opts: { domain?: string; createDnsRecord?: boolean }, onLog?: LogFn) {
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

    // ponytail: EasyPanel sobe como serviço Swarm (não um `docker run` comum) —
    // na primeira instalação a imagem ainda precisa ser baixada, o que pode
    // levar bem mais que alguns segundos. Um único sleep+check curto marcava
    // "não instalado" mesmo quando ia terminar de subir logo em seguida.
    onLog?.('Aguardando o EasyPanel subir (pode levar até alguns minutos na primeira vez)...\n');
    const running = await this.waitForEasyPanelRunning(options, onLog);

    const url = opts.domain ? `https://${opts.domain}` : `http://${server.publicIp ?? server.hostname}:3000`;

    await this.prisma.server.update({
      where: { id },
      data: { easypanelInstalled: running, easypanelUrl: running ? url : null },
    });

    return { ok: running, output: install.stdout, url: running ? url : null, warnings };
  }

  private async waitForEasyPanelRunning(options: SshConnectOptions, onLog?: LogFn, attempts = 18, delayMs = 5000) {
    for (let i = 0; i < attempts; i++) {
      const check = await this.ssh.runCommand(options, "sudo docker ps --filter name=easypanel --format '{{.Status}}'", 15_000);
      if (check.stdout.toLowerCase().includes('up')) return true;
      onLog?.(`Ainda subindo... (tentativa ${i + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  async easypanelStatus(id: string) {
    const server = await this.getRawServer(id);
    if (!server.dockerInstalled) {
      return { installed: false as const };
    }
    const options = this.toConnectOptions(server);

    // ponytail: sempre reconsulta a realidade em vez de confiar só na flag
    // salva — se a checagem inicial (na instalação) tivesse marcado errado
    // por timing, o status nunca mais se corrigiria sozinho sem isso.
    const check = await this.ssh.runCommand(options, "sudo docker ps --filter name=easypanel --format '{{.Status}}'", 15_000);
    const running = check.ok && check.stdout.toLowerCase().includes('up');

    const url = server.easypanelUrl ?? `http://${server.publicIp ?? server.hostname}:3000`;
    if (running !== server.easypanelInstalled) {
      await this.prisma.server.update({
        where: { id },
        data: { easypanelInstalled: running, easypanelUrl: running ? url : null },
      });
    }

    if (!running) return { installed: false as const };

    const psRes = await this.ssh.runCommand(
      options,
      "sudo docker ps -a --format '{{.ID}}|{{.Image}}|{{.Status}}|{{.Names}}'",
      15_000,
    );
    return { installed: true as const, url, containers: this.parseContainers(psRes.stdout) };
  }

  /**
   * Confirma, a partir do próprio Velix (não do servidor), se o domínio já
   * responde em HTTPS — ou seja, se o usuário já configurou o domínio DENTRO
   * do EasyPanel (isso é feito manualmente na UI dele, não tem parâmetro de
   * instalação pra isso). Só faz sentido fechar a porta 3000 depois disso.
   */
  async verifyEasyPanelDomain(domain: string) {
    try {
      const res = await fetch(`https://${domain}`, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      return { reachable: res.status < 500, statusCode: res.status };
    } catch (err) {
      return { reachable: false, statusCode: null, message: err instanceof Error ? err.message : 'Falha ao consultar domínio' };
    }
  }

  /** Bloqueia acesso externo à porta 3000 (EasyPanel) via ufw — só depois que o domínio já estiver respondendo. */
  async lockEasyPanelPort(id: string) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);

    const hasUfw = await this.ssh.runCommand(options, 'command -v ufw', 10_000);
    if (!hasUfw.ok) {
      throw new BadRequestException('ufw não está instalado neste servidor — configure o firewall manualmente para bloquear a porta 3000');
    }
    const result = await this.ssh.runCommand(options, 'sudo ufw deny 3000/tcp && sudo ufw reload', 30_000);
    if (!result.ok) {
      throw new BadRequestException(`Falha ao configurar o firewall: ${result.stderr || result.message}`);
    }
    return { ok: true, message: 'Porta 3000 bloqueada para acesso externo. O painel continua acessível pelo domínio.' };
  }

  async uninstallEasyPanel(id: string, onLog?: LogFn) {
    const server = await this.getRawServer(id);
    const options = this.toConnectOptions(server);
    const stream: LogFn | undefined = onLog && ((chunk) => onLog(chunk));

    onLog?.('Removendo stack do EasyPanel...\n');
    await this.ssh.runCommand(options, 'sudo docker stack rm easypanel', 60_000, stream);

    onLog?.('Aguardando containers finalizarem...\n');
    await new Promise((r) => setTimeout(r, 5000));

    onLog?.('Saindo do Docker Swarm...\n');
    await this.ssh.runCommand(options, 'sudo docker swarm leave --force', 30_000, stream);

    onLog?.('Removendo dados residuais (/etc/easypanel)...\n');
    await this.ssh.runCommand(options, 'sudo rm -rf /etc/easypanel', 15_000);

    await this.prisma.server.update({
      where: { id },
      data: { easypanelInstalled: false, easypanelUrl: null },
    });

    return { ok: true };
  }
}
