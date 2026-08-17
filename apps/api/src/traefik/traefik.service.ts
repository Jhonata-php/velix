import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { CloudflareService } from '../cloudflare/cloudflare.service';
import { CreateDomainDto } from './dto/create-domain.dto';
import {
  PROXY_NETWORK,
  TRAEFIK_CONTAINER,
  SHARED_PROXY_MARKER,
  VELIX_ROOT,
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
  upsertEnvVar,
} from './traefik.util';
import { checkDns, type DnsCheckResult } from './dns.util';
import { findCertificateInAcmeJson, parseCertificate, type CertificateInfo } from './certificate.util';

type LogFn = (line: string) => void;

@Injectable()
export class TraefikService {
  private readonly logger = new Logger(TraefikService.name);

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

    const shared = await this.ssh.runCommand(options, `sudo test -f ${SHARED_PROXY_MARKER} && echo yes`, 15_000);
    if (shared.stdout.includes('yes')) {
      return {
        ok: true,
        output:
          'Este servidor já usa o Traefik do próprio Velix, que também atende as aplicações do painel. Não há nada a instalar — pode associar domínios direto.\n',
        version: null,
      };
    }

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

    // Três situações diferentes com o mesmo nome de container:
    //
    // 1. Instalado pelo painel — tem o docker-compose.yml em TRAEFIK_DIR.
    // 2. O Traefik do próprio Velix, no servidor onde ele roda, configurado
    //    pelo instalador para também servir o painel (marcador presente). Desde
    //    que o instalador passou a habilitar o provedor de arquivo, este caso
    //    é utilizável e não precisa de um segundo Traefik.
    // 3. Um Traefik de terceiros ocupando 80/443 — aí sim não dá pra usar.
    //
    // Sem essa distinção, o caso 2 caía no 3 e o painel pedia pra instalar um
    // Traefik que colidiria de porta com o que já estava ali servindo ele mesmo.
    const probe = running
      ? await this.ssh.runCommand(
          options,
          `sudo test -f ${TRAEFIK_DIR}/docker-compose.yml && echo own; sudo test -f ${SHARED_PROXY_MARKER} && echo shared`,
          15_000,
        )
      : null;

    const installedByPanel = !!probe?.stdout.includes('own');
    const sharedWithPanel = !!probe?.stdout.includes('shared');
    const managed = installedByPanel || sharedWithPanel;
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
      /** Traefik de terceiros nas portas 80/443 — não dá pra usar nem instalar. */
      foreignTraefik: foreign,
      /** É o Traefik do próprio Velix, servindo também as aplicações do painel.
       * A tela usa pra explicar que não há nada a instalar aqui. */
      sharedWithPanel,
      network: PROXY_NETWORK,
      ports: { http: 80, https: 443 },
      publicIp: server.publicIp,
      domainsCount,
      statusText: ps.stdout.trim() || null,
    };
  }

  async uninstallTraefik(serverId: string, onLog?: LogFn) {
    const { options } = await this.servers.getServerWithConnectOptions(serverId);

    // Sem esta guarda, o caminho de baixo cai no `docker rm -f velix-traefik` e
    // mata o Traefik que serve o PRÓPRIO painel — o usuário perderia o acesso
    // ao Velix clicando em "desinstalar" numa tela do Velix, sem volta pela
    // interface. Desfazer isso é papel do instalador, não de um botão.
    const shared = await this.ssh.runCommand(options, `sudo test -f ${SHARED_PROXY_MARKER} && echo yes`, 15_000);
    if (shared.stdout.includes('yes')) {
      throw new BadRequestException(
        'Este Traefik atende o próprio painel do Velix — removê-lo deixaria o Velix inacessível. Para desativá-lo, reinstale o Velix sem domínio.',
      );
    }

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

  private async upsertCloudflareRecord(hostname: string, ip: string, proxied: boolean) {
    const zones = await this.cloudflare.listZones();
    const zone = zones
      .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (!zone) throw new Error(`Nenhuma zona Cloudflare encontrada para ${hostname}`);
    const records = await this.cloudflare.listRecords(zone.id);
    const existing = records.find((r) => r.name === hostname && r.type === 'A');
    const record = existing
      ? await this.cloudflare.updateRecord(zone.id, existing.id, { content: ip, proxied })
      : await this.cloudflare.createRecord(zone.id, { type: 'A', name: hostname, content: ip, proxied });
    return { recordId: record.id, zoneId: zone.id };
  }

  /**
   * Garante que o Traefik compartilhado do servidor local (ver
   * SHARED_PROXY_MARKER) tem o token da Cloudflare atualizado antes de emitir
   * um certificado. O resolvedor "velix-le" usa DNS-01 via Cloudflare — sem o
   * token, a emissão nunca completa, e o domínio fica preso em "verificando"
   * pra sempre sem nenhum erro visível, porque a rota HTTP já funciona (só o
   * certificado é que não sai).
   *
   * Não mexe em nada quando: o servidor não é o local, o Traefik dali não é o
   * compartilhado (é um instalado pelo painel, que já recebe o token na
   * própria instalação — ver installTraefik), ou o token já está sincronizado
   * (evita reiniciar o Traefik à toa a cada domínio novo).
   */
  private async ensureSharedProxyCloudflareToken(
    server: { id: string; isLocal: boolean },
    options: SshConnectOptions,
  ) {
    if (!server.isLocal) return;

    const shared = await this.ssh.runCommand(options, `sudo test -f ${SHARED_PROXY_MARKER} && echo yes`, 15_000);
    if (!shared.stdout.includes('yes')) return;

    if (!(await this.cloudflare.hasAccount())) {
      throw new BadRequestException(
        'Este servidor publica domínios via Cloudflare (validação DNS) — conecte uma conta Cloudflare em Configurações antes de associar um domínio aqui.',
      );
    }

    const token = await this.cloudflare.getTokenForDnsChallenge();
    const envPath = `${VELIX_ROOT}/.env`;

    const current = await this.ssh.runCommand(options, `sudo cat ${envPath}`, 15_000);
    if (!current.ok) throw new BadRequestException('Não foi possível ler a configuração do servidor para sincronizar o token da Cloudflare.');

    const updated = upsertEnvVar(current.stdout, 'CF_DNS_API_TOKEN', token);
    if (updated === current.stdout) return; // já sincronizado

    await this.writeRemoteFile(options, envPath, updated, '600');

    // Só o serviço traefik reinicia — api/web/postgres continuam de pé, e é
    // rápido o bastante pra rodar no caminho síncrono de criar um domínio.
    const up = await this.ssh.runCommand(
      options,
      `cd ${VELIX_ROOT} && sudo docker compose --env-file .env up -d traefik`,
      120_000,
    );
    if (!up.ok) {
      throw new BadRequestException('Token da Cloudflare salvo, mas falhou ao reiniciar o Traefik — tente associar o domínio de novo em instantes.');
    }
  }

  async createDomain(serverId: string, dto: CreateDomainDto) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.traefikInstalled) {
      throw new BadRequestException('Instale o Traefik neste servidor antes de adicionar domínios');
    }
    await this.ensureSharedProxyCloudflareToken(server, options);
    const createDns = dto.createDnsRecord ?? true;

    const existing = await this.prisma.domain.findUnique({ where: { hostname: dto.hostname } });
    if (existing) {
      throw new ConflictException(`O domínio ${dto.hostname} já está cadastrado no Velix`);
    }

    const proxied = dto.proxied ?? false;
    const domain = await this.prisma.domain.create({
      data: { serverId, hostname: dto.hostname, targetPort: dto.targetPort, createDnsRecord: createDns, proxied },
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

    await this.attachDnsRecordIfRequested(domain.id, dto.hostname, createDns, server.publicIp, proxied);

    return this.prisma.domain.findUnique({ where: { id: domain.id } });
  }

  /** Registro DNS na Cloudflare (opcional). Falha vira lastError no domínio, não derruba o cadastro. */
  private async attachDnsRecordIfRequested(
    domainId: string,
    hostname: string,
    createDns: boolean,
    publicIp: string | null,
    proxied: boolean,
  ) {
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
      const { recordId, zoneId } = await this.upsertCloudflareRecord(hostname, publicIp, proxied);
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
    opts: {
      hostname: string;
      serviceName: string;
      containerName: string;
      containerPort: number;
      createDnsRecord?: boolean;
      proxied?: boolean;
    },
  ) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.traefikInstalled) {
      throw new BadRequestException('Instale o Traefik neste servidor antes de associar um domínio à aplicação');
    }
    await this.ensureSharedProxyCloudflareToken(server, options);
    const createDns = opts.createDnsRecord ?? true;
    const proxied = opts.proxied ?? false;

    // Já existe um domínio com esse hostname em OUTRO projeto: aí sim é
    // conflito de verdade (roubar domínio alheio). Dentro do mesmo projeto —
    // caso comum ao reimplantar depois de recriar o serviço, ou trocar pra
    // qual serviço o domínio aponta — reaproveita o registro e só atualiza
    // rota/IP em vez de falhar o deploy inteiro no último passo.
    const existing = await this.prisma.domain.findUnique({ where: { hostname: opts.hostname } });
    if (existing && existing.applicationId !== applicationId) {
      throw new ConflictException(`O domínio ${opts.hostname} já está cadastrado em outro projeto no Velix`);
    }

    const domain = existing
      ? await this.prisma.domain.update({
          where: { id: existing.id },
          data: {
            serverId,
            serviceName: opts.serviceName,
            targetPort: opts.containerPort,
            createDnsRecord: createDns,
            proxied,
            status: 'PENDING',
            lastError: null,
          },
        })
      : await this.prisma.domain.create({
          data: {
            serverId,
            applicationId,
            hostname: opts.hostname,
            serviceName: opts.serviceName,
            targetPort: opts.containerPort,
            createDnsRecord: createDns,
            proxied,
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

    await this.attachDnsRecordIfRequested(domain.id, opts.hostname, createDns, server.publicIp, proxied);

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

  /**
   * `verifyDomain` é quem de fato atualiza o status (PENDING → ACTIVE/ERROR)
   * — sem chamar ela, um domínio criado fica PENDING pra sempre no banco,
   * porque nada mais escreve nesse campo. Antes disso só existia um botão
   * manual "Verificar agora" na tela de domínios do servidor; a aba de
   * Domínios dentro do projeto não tinha nada equivalente, então quem
   * associava um domínio por ali ficava olhando "PENDING" parado sem saber
   * que precisava ir noutra tela clicar em outro botão. Roda a cada 2
   * minutos pra todo domínio ainda não confirmado — DNS recém-propagado ou
   * certificado ainda sendo emitido leva minutos, não faz sentido cobrar do
   * usuário ficar clicando até resolver sozinho.
   */
  @Cron('*/2 * * * *')
  async reverifyPendingDomains() {
    const pending = await this.prisma.domain.findMany({
      where: { status: { in: ['PENDING', 'ERROR'] } },
      select: { id: true },
    });
    for (const { id } of pending) {
      try {
        await this.verifyDomain(id);
      } catch (err) {
        this.logger.warn(`Falha ao reverificar domínio ${id}: ${err instanceof Error ? err.message : err}`);
      }
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
