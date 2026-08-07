import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import {
  PROXY_NETWORK,
  TRAEFIK_CONTAINER,
  TRAEFIK_DIR,
  TRAEFIK_DYNAMIC_DIR,
  TRAEFIK_CERTS_DIR,
  TRAEFIK_LOGS_DIR,
  isContainerUp,
  isValidAcmeEmail,
  parseTraefikVersion,
  renderComposeFile,
  renderDynamicRoute,
  renderDynamicRouteToContainer,
  renderStaticConfig,
  routerName,
} from './traefik.util';
import { checkDns, type DnsCheckResult } from './dns.util';
import { findCertificateInAcmeJson, parseCertificate, type CertificateInfo } from './certificate.util';

type LogFn = (line: string) => void;

@Injectable()
export class TraefikService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly servers: ServersService,
    private readonly cloudflare: CloudflareService,
  ) {}

  /** Escreve um arquivo no servidor remoto — ver SshService.writeRemoteFile. */
  private async writeRemoteFile(options: SshConnectOptions, remotePath: string, content: string, mode = '644') {
    const result = await this.ssh.writeRemoteFile(options, remotePath, content, mode);
    if (!result.ok) throw new BadRequestException(result.message);
  }

  private async waitForTraefik(options: SshConnectOptions, onLog?: LogFn, attempts = 12, delayMs = 5000) {
    for (let i = 0; i < attempts; i++) {
      const check = await this.ssh.runCommand(
        options,
        `sudo docker ps --filter name=${TRAEFIK_CONTAINER} --format '{{.Status}}'`,
        15_000,
      );
      if (isContainerUp(check.stdout)) return true;
      onLog?.(`Ainda subindo... (tentativa ${i + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  private async readTraefikVersion(options: SshConnectOptions): Promise<string | null> {
    const res = await this.ssh.runCommand(options, `sudo docker exec ${TRAEFIK_CONTAINER} traefik version`, 15_000);
    return parseTraefikVersion(res.stdout);
  }

  async installTraefik(serverId: string, opts: { acmeEmail?: string }, onLog?: LogFn) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes do Traefik');
    }
    if (!(await this.cloudflare.hasAccount())) {
      throw new BadRequestException('Conecte uma conta Cloudflare em Configurações — o SSL automático (DNS-01) precisa dela');
    }
    // ponytail-bugfix: um valor default tipo "admin@velix.local" parece
    // inofensivo mas o Let's Encrypt rejeita a CONTA ACME inteira com esse
    // contato (TLD .local não é público) — toda emissão de certificado falha
    // depois, sem nenhum erro visível na instalação em si. Por isso exigido
    // aqui, não só sugerido.
    if (!opts.acmeEmail || !isValidAcmeEmail(opts.acmeEmail)) {
      throw new BadRequestException('Informe um e-mail de contato válido para o Let\'s Encrypt (com domínio público, ex.: voce@seudominio.com)');
    }
    const stream: LogFn | undefined = onLog && ((chunk) => onLog(chunk));

    onLog?.('Verificando se as portas 80 e 443 estão livres...\n');
    const ports = await this.ssh.runCommand(options, "sudo ss -ltnH '( sport = :80 or sport = :443 )' 2>/dev/null", 15_000);
    if (ports.stdout.trim()) {
      // No servidor onde o Velix roda com domínio, quem está nas portas é o
      // Traefik do próprio painel. Dizer só "portas em uso" mandaria o usuário
      // caçar um culpado que é o próprio Velix — e removê-lo derrubaria o painel.
      const ownTraefik = server.isLocal && ports.stdout.includes(':80');
      return {
        ok: false,
        output: ownTraefik
          ? `As portas 80/443 estão ocupadas pelo Traefik do próprio Velix, que atende o painel neste servidor.\n\nNão remova esse Traefik: o painel fica inacessível. Para publicar aplicações com domínio aqui, use um servidor separado por enquanto — reaproveitar o Traefik do painel para rotas de aplicação ainda não é suportado.\n\nPortas em uso:\n${ports.stdout}`
          : `As portas 80/443 já estão em uso neste servidor:\n${ports.stdout}\nLibere-as (por exemplo, removendo EasyPanel/Nginx) antes de instalar o Traefik do Velix.`,
        version: null,
      };
    }

    onLog?.(`Criando rede Docker ${PROXY_NETWORK}...\n`);
    await this.ssh.runCommand(options, `sudo docker network create ${PROXY_NETWORK} 2>/dev/null || true`, 15_000);

    onLog?.(`Criando estrutura em ${TRAEFIK_DIR}...\n`);
    await this.ssh.runCommand(options, `sudo mkdir -p ${TRAEFIK_DYNAMIC_DIR} ${TRAEFIK_CERTS_DIR} ${TRAEFIK_LOGS_DIR}`, 15_000);

    const token = await this.cloudflare.getTokenForDnsChallenge();

    onLog?.('Gravando configuração do Traefik...\n');
    await this.writeRemoteFile(options, `${TRAEFIK_DIR}/traefik.yml`, renderStaticConfig(opts.acmeEmail), '644');
    await this.writeRemoteFile(options, `${TRAEFIK_DIR}/docker-compose.yml`, renderComposeFile(), '644');
    await this.writeRemoteFile(options, `${TRAEFIK_DIR}/.env`, `CF_DNS_API_TOKEN=${token}\n`, '600');

    onLog?.('Subindo o Traefik (docker compose up -d)...\n');
    const up = await this.ssh.runCommand(options, `cd ${TRAEFIK_DIR} && sudo docker compose up -d`, 180_000, stream);
    if (!up.ok) {
      return { ok: false, output: up.stdout + up.stderr, version: null };
    }

    onLog?.('Aguardando o Traefik ficar de pé...\n');
    const running = await this.waitForTraefik(options, onLog);
    const version = running ? await this.readTraefikVersion(options) : null;

    await this.prisma.server.update({
      where: { id: serverId },
      data: { traefikInstalled: running, traefikVersion: version, ...(running ? { platformState: 'READY' } : { platformState: 'ERROR' }) },
    });

    return { ok: running, output: up.stdout, version };
  }

  async traefikStatus(serverId: string) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    const cloudflareConnected = await this.cloudflare.hasAccount();
    if (!server.dockerInstalled) {
      return { installed: false as const, dockerInstalled: false, cloudflareConnected };
    }
    const ps = await this.ssh.runCommand(
      options,
      `sudo docker ps --filter name=${TRAEFIK_CONTAINER} --format '{{.Status}}'`,
      15_000,
    );
    const running = ps.ok && isContainerUp(ps.stdout);

    // Armadilha silenciosa: no servidor onde o Velix roda, o Traefik do próprio
    // painel (criado pelo install.sh quando há domínio) usa o MESMO nome de
    // container. Sem distinguir os dois, a tela diria "Traefik ativo", aceitaria
    // domínios, e as rotas nunca funcionariam — aquele Traefik lê só labels do
    // Docker, enquanto o Velix escreve rotas em arquivo. O diretório de
    // configuração só existe quando quem instalou foi o painel.
    const managed = running
      ? (await this.ssh.runCommand(options, `sudo test -f ${TRAEFIK_DIR}/docker-compose.yml && echo yes`, 15_000)).stdout.includes('yes')
      : false;
    const foreign = running && !managed;

    const version = managed ? (await this.readTraefikVersion(options)) ?? server.traefikVersion : null;

    if (managed !== server.traefikInstalled) {
      await this.prisma.server.update({
        where: { id: serverId },
        data: { traefikInstalled: managed, traefikVersion: version },
      });
    }

    const domainsCount = await this.prisma.domain.count({ where: { serverId } });

    return {
      installed: managed,
      dockerInstalled: true,
      cloudflareConnected,
      version,
      running: managed,
      /** Há um Traefik nas portas 80/443 que não foi instalado pelo painel —
       * tipicamente o do próprio Velix, no servidor onde ele roda. */
      foreignTraefik: foreign,
      network: PROXY_NETWORK,
      ports: { http: 80, https: 443 },
      publicIp: server.publicIp,
      domainsCount,
      statusText: ps.stdout.trim() || null,
    };
  }

  async uninstallTraefik(serverId: string, onLog?: LogFn) {
    const { options } = await this.servers.getServerWithConnectOptions(serverId);
    const stream: LogFn | undefined = onLog && ((chunk) => onLog(chunk));

    onLog?.('Parando e removendo o Traefik...\n');
    await this.ssh.runCommand(
      options,
      `cd ${TRAEFIK_DIR} && sudo docker compose down 2>/dev/null || sudo docker rm -f ${TRAEFIK_CONTAINER} 2>/dev/null || true`,
      60_000,
      stream,
    );

    onLog?.(`Removendo configuração (${TRAEFIK_DIR})...\n`);
    await this.ssh.runCommand(options, `sudo rm -rf ${TRAEFIK_DIR}`, 15_000);

    // ponytail: tenta remover a rede, mas ignora falha — se alguma aplicação
    // ainda estiver conectada a ela, a rede fica (correto), sem travar o uninstall.
    await this.ssh.runCommand(options, `sudo docker network rm ${PROXY_NETWORK} 2>/dev/null || true`, 15_000);

    await this.prisma.server.update({
      where: { id: serverId },
      data: { traefikInstalled: false, traefikVersion: null, platformState: 'NOT_PREPARED' },
    });

    return { ok: true };
  }

  /** Fluxo "Preparar servidor para o Velix" — encadeia Docker + rede + Traefik. */
  async prepareServer(serverId: string, opts: { acmeEmail?: string }, onLog?: LogFn) {
    await this.prisma.server.update({ where: { id: serverId }, data: { platformState: 'PREPARING' } });
    try {
      const { server } = await this.servers.getServerWithConnectOptions(serverId);

      if (!server.dockerInstalled) {
        onLog?.('== Instalando Docker ==\n');
        const docker = await this.servers.installDocker(serverId, onLog);
        if (!docker.ok) {
          await this.prisma.server.update({ where: { id: serverId }, data: { platformState: 'ERROR' } });
          return { ok: false, output: docker.output };
        }
      } else {
        onLog?.('Docker já instalado.\n');
      }

      onLog?.('== Instalando Traefik ==\n');
      const traefik = await this.installTraefik(serverId, opts, onLog);
      if (!traefik.ok) {
        await this.prisma.server.update({ where: { id: serverId }, data: { platformState: 'ERROR' } });
        return traefik;
      }
      // installTraefik já marca platformState=READY em caso de sucesso.
      onLog?.('== Servidor pronto para o Velix ==\n');
      return { ok: true };
    } catch (err) {
      await this.prisma.server.update({ where: { id: serverId }, data: { platformState: 'ERROR' } });
      throw err;
    }
  }

  // ---- Domínios ----

  async listDomains(serverId: string) {
    return this.prisma.domain.findMany({ where: { serverId }, orderBy: { createdAt: 'desc' } });
  }

  private async upsertCloudflareRecord(hostname: string, ip: string) {
    const zones = await this.cloudflare.listZones();
    const zone = zones
      .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!zone) throw new Error(`Nenhuma zona Cloudflare encontrada para ${hostname}`);
    const records = await this.cloudflare.listRecords(zone.id);
    const existing = records.find((r) => r.name === hostname && r.type === 'A');
    const record = existing
      ? await this.cloudflare.updateRecord(zone.id, existing.id, { content: ip })
      : await this.cloudflare.createRecord(zone.id, { type: 'A', name: hostname, content: ip, proxied: false });
    return { recordId: record.id, zoneId: zone.id };
  }

  async createDomain(serverId: string, dto: CreateDomainDto) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.traefikInstalled) {
      throw new BadRequestException('Instale o Traefik neste servidor antes de adicionar domínios');
    }
    const createDns = dto.createDnsRecord ?? true;

    const existing = await this.prisma.domain.findUnique({ where: { hostname: dto.hostname } });
    if (existing) {
      throw new ConflictException(`O domínio ${dto.hostname} já está cadastrado no Velix`);
    }

    const domain = await this.prisma.domain.create({
      data: { serverId, hostname: dto.hostname, targetPort: dto.targetPort, createDnsRecord: createDns },
    });

    // Escreve o arquivo dinâmico do Traefik (roteia hostname -> porta no host).
    const name = routerName(domain.id);
    try {
      await this.writeRemoteFile(
        options,
        `${TRAEFIK_DYNAMIC_DIR}/${domain.id}.yml`,
        renderDynamicRoute({ name, hostname: dto.hostname, targetPort: dto.targetPort }),
        '644',
      );
    } catch (err) {
      await this.prisma.domain.update({
        where: { id: domain.id },
        data: { status: 'ERROR', lastError: err instanceof Error ? err.message : 'Falha ao configurar rota no Traefik' },
      });
      throw err;
    }

    await this.attachDnsRecordIfRequested(domain.id, dto.hostname, createDns, server.publicIp);

    return this.prisma.domain.findUnique({ where: { id: domain.id } });
  }

  /** Registro DNS na Cloudflare (opcional). Falha vira lastError no domínio, não derruba o cadastro. */
  private async attachDnsRecordIfRequested(domainId: string, hostname: string, createDns: boolean, publicIp: string | null) {
    if (!createDns) return;
    if (!publicIp) {
      await this.prisma.domain.update({
        where: { id: domainId },
        data: { status: 'ERROR', lastError: 'Servidor sem IP público — registro DNS não criado automaticamente.' },
      });
      return;
    }
    if (!(await this.cloudflare.hasAccount())) {
      await this.prisma.domain.update({
        where: { id: domainId },
        data: { status: 'ERROR', lastError: 'Cloudflare não conectado — registro DNS não criado automaticamente.' },
      });
      return;
    }
    try {
      const { recordId, zoneId } = await this.upsertCloudflareRecord(hostname, publicIp);
      await this.prisma.domain.update({
        where: { id: domainId },
        data: { cloudflareRecordId: recordId, cloudflareZoneId: zoneId, lastError: null },
      });
    } catch (err) {
      await this.prisma.domain.update({
        where: { id: domainId },
        data: { status: 'ERROR', lastError: err instanceof Error ? err.message : 'Falha ao criar registro DNS na Cloudflare' },
      });
    }
  }

  /**
   * Associa um domínio a uma aplicação implantada pelo Velix — mesma mecânica
   * de `createDomain`, mas a rota do Traefik aponta pro nome do container na
   * rede velix-proxy em vez de uma porta solta no host.
   */
  async createApplicationDomain(
    serverId: string,
    applicationId: string,
    opts: { hostname: string; serviceName: string; containerName: string; containerPort: number; createDnsRecord?: boolean },
  ) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.traefikInstalled) {
      throw new BadRequestException('Instale o Traefik neste servidor antes de associar um domínio à aplicação');
    }
    const createDns = opts.createDnsRecord ?? true;

    const existing = await this.prisma.domain.findUnique({ where: { hostname: opts.hostname } });
    if (existing) {
      throw new ConflictException(`O domínio ${opts.hostname} já está cadastrado no Velix`);
    }

    const domain = await this.prisma.domain.create({
      data: {
        serverId,
        applicationId,
        hostname: opts.hostname,
        serviceName: opts.serviceName,
        targetPort: opts.containerPort,
        createDnsRecord: createDns,
      },
    });

    const name = routerName(domain.id);
    try {
      await this.writeRemoteFile(
        options,
        `${TRAEFIK_DYNAMIC_DIR}/${domain.id}.yml`,
        renderDynamicRouteToContainer({ name, hostname: opts.hostname, containerName: opts.containerName, containerPort: opts.containerPort }),
        '644',
      );
    } catch (err) {
      await this.prisma.domain.update({
        where: { id: domain.id },
        data: { status: 'ERROR', lastError: err instanceof Error ? err.message : 'Falha ao configurar rota no Traefik' },
      });
      throw err;
    }

    await this.attachDnsRecordIfRequested(domain.id, opts.hostname, createDns, server.publicIp);

    return this.prisma.domain.findUnique({ where: { id: domain.id } });
  }

  /** Troca serviço/porta de destino de um domínio já existente sem recriar o container. */
  async updateApplicationDomain(domainId: string, opts: { serviceName: string; containerName: string; containerPort: number }) {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    const { options } = await this.servers.getServerWithConnectOptions(domain.serverId);

    const name = routerName(domain.id);
    await this.writeRemoteFile(
      options,
      `${TRAEFIK_DYNAMIC_DIR}/${domain.id}.yml`,
      renderDynamicRouteToContainer({ name, hostname: domain.hostname, containerName: opts.containerName, containerPort: opts.containerPort }),
      '644',
    );

    return this.prisma.domain.update({
      where: { id: domainId },
      data: { serviceName: opts.serviceName, targetPort: opts.containerPort, status: 'PENDING', lastError: null },
    });
  }

  /** Resolução DNS real do domínio comparada ao IP público do servidor. */
  async checkDomainDns(domainId: string): Promise<DnsCheckResult> {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId }, include: { server: true } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    return checkDns(domain.hostname, domain.server.publicIp);
  }

  /** Lê o acme.json real do servidor e interpreta o certificado emitido pro domínio. */
  async checkDomainCertificate(domainId: string): Promise<CertificateInfo> {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    const { options } = await this.servers.getServerWithConnectOptions(domain.serverId);

    const read = await this.ssh.runCommand(options, `sudo cat ${TRAEFIK_CERTS_DIR}/acme.json 2>/dev/null`, 15_000);
    if (!read.ok || !read.stdout.trim()) {
      return { state: 'NOT_FOUND' };
    }
    const base64Cert = findCertificateInAcmeJson(read.stdout, domain.hostname);
    if (!base64Cert) return { state: 'NOT_FOUND' };
    return parseCertificate(base64Cert);
  }

  /** Confere, do próprio Velix, se o domínio já responde em HTTPS (certificado emitido + rota ativa). */
  async verifyDomain(domainId: string) {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    try {
      const res = await fetch(`https://${domain.hostname}`, { method: 'GET', signal: AbortSignal.timeout(12_000) });
      const active = res.status < 500;
      return this.prisma.domain.update({
        where: { id: domainId },
        data: {
          status: active ? 'ACTIVE' : 'ERROR',
          lastError: active ? null : `HTTPS respondeu com status ${res.status}`,
          lastCheckedAt: new Date(),
        },
      });
    } catch (err) {
      return this.prisma.domain.update({
        where: { id: domainId },
        data: {
          status: 'PENDING',
          lastError: err instanceof Error ? err.message : 'Domínio ainda não responde em HTTPS',
          lastCheckedAt: new Date(),
        },
      });
    }
  }

  async deleteDomain(domainId: string) {
    const domain = await this.prisma.domain.findUnique({ where: { id: domainId } });
    if (!domain) throw new NotFoundException('Domínio não encontrado');
    const { options } = await this.servers.getServerWithConnectOptions(domain.serverId);

    // Remove o arquivo de rota do Traefik (watch=true recarrega sozinho).
    await this.ssh.runCommand(options, `sudo rm -f ${TRAEFIK_DYNAMIC_DIR}/${domain.id}.yml`, 15_000);

    // Remove o registro DNS só se foi o Velix que criou.
    if (domain.cloudflareRecordId && domain.cloudflareZoneId) {
      await this.cloudflare.deleteRecord(domain.cloudflareZoneId, domain.cloudflareRecordId).catch(() => undefined);
    }

    await this.prisma.domain.delete({ where: { id: domainId } });
    return { ok: true };
  }
}
