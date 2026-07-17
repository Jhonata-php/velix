import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { TraefikService } from '../traefik/traefik.service';
import { CatalogService } from '../catalog/catalog.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import {
  renderCompose,
  renderServiceEnvFiles,
  resolveSecrets,
  resolveVariables,
  resolveIncludedServices,
  optionalServices,
  servicePorts,
  primaryContainerName,
  scanSecurityRisks,
  highestRiskLevel,
  validateManifest,
} from '../catalog/catalog.util';
import { PROXY_NETWORK } from '../traefik/traefik.util';
import { appDir, allContainersUp, parseExposedPorts, slugify } from './applications.util';
import { DeployApplicationDto } from './dto/deploy-application.dto';
import { CreateApplicationDomainDto } from './dto/create-application-domain.dto';

type LogFn = (line: string) => void;

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export interface EndpointPort {
  port: number;
  protocol: string;
  recommended: boolean;
  source: 'template' | 'container';
}

export interface EndpointService {
  serviceName: string;
  containerName: string;
  image: string;
  running: boolean;
  ports: EndpointPort[];
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly servers: ServersService,
    private readonly traefik: TraefikService,
    private readonly catalog: CatalogService,
  ) {}

  async listForServer(serverId: string) {
    return this.prisma.application.findMany({ where: { serverId }, orderBy: { deployedAt: 'desc' }, include: { domains: true } });
  }

  async getOne(id: string) {
    const app = await this.prisma.application.findUnique({ where: { id }, include: { domains: true } });
    if (!app) throw new NotFoundException('Aplicação não encontrada');
    return app;
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name);
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = await this.prisma.application.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Não foi possível gerar um identificador único para a aplicação — tente outro nome.');
  }

  private async waitForContainers(options: SshConnectOptions, expectedNames: string[], onLog?: LogFn, attempts = 20, delayMs = 3000) {
    for (let i = 0; i < attempts; i++) {
      const check = await this.ssh.runCommand(options, "sudo docker ps --format '{{.Names}}|{{.Status}}'", 15_000);
      if (allContainersUp(check.stdout, expectedNames)) return true;
      onLog?.(`Ainda subindo... (tentativa ${i + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  /**
   * Implanta uma aplicação do catálogo num servidor: renderiza o compose,
   * envia pro servidor, sobe via `docker compose up`, confere os containers e,
   * se um domínio foi pedido, associa a rota no Traefik. Qualquer falha marca
   * a aplicação como ERROR (ela continua existindo — nada fica implantado sem
   * rastro, pra o usuário poder ver o que deu errado e tentar de novo).
   */
  async deploy(serverId: string, dto: DeployApplicationDto, onLog?: LogFn) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de implantar aplicações');
    }
    if (dto.domain) {
      if (!server.traefikInstalled) {
        throw new BadRequestException('Instale o Traefik neste servidor antes de associar um domínio à aplicação');
      }
      // Revalidado aqui (não só no DTO) porque esse método também é chamado via
      // o WebSocket /ops, que não passa pelo ValidationPipe do Nest.
      if (!HOSTNAME_PATTERN.test(dto.domain.hostname)) {
        throw new BadRequestException('Domínio inválido (ex.: app.seudominio.com)');
      }
    }
    if (!dto.name?.trim() || dto.name.trim().length < 2) {
      throw new BadRequestException('Informe um nome válido para a aplicação');
    }

    const manifest = this.catalog.getManifest(dto.manifestSlug);
    const validation = validateManifest(manifest);
    if (!validation.ok) {
      throw new BadRequestException(`Manifesto inválido: ${validation.errors.join('; ')}`);
    }
    const risk = highestRiskLevel(scanSecurityRisks(manifest));
    if (risk === 'blocked') {
      throw new BadRequestException('Esta aplicação foi bloqueada pela análise de segurança e não pode ser implantada.');
    }

    const appSlug = await this.uniqueSlug(dto.name);
    const selectedServices = dto.selectedServices ?? [];
    const secretsMap = resolveSecrets(manifest);
    const variablesMap = resolveVariables(manifest, dto.variables);
    const compose = renderCompose(manifest, appSlug, variablesMap, selectedServices);
    const envFiles = renderServiceEnvFiles(manifest, appSlug, secretsMap, variablesMap, selectedServices);
    const dir = appDir(appSlug);
    const includedServices = resolveIncludedServices(manifest, selectedServices);
    const expectedContainers = includedServices.map((s) => `${appSlug}_${s.name}`);

    const application = await this.prisma.application.create({
      data: {
        serverId,
        name: dto.name,
        slug: appSlug,
        description: dto.description,
        environment: dto.environment,
        tags: dto.tags ?? [],
        manifestSlug: manifest.slug,
        manifestVersion: manifest.version,
        status: 'DEPLOYING',
        composeRendered: compose,
        selectedServices,
        secretsEnc: Object.keys(secretsMap).length > 0 ? encryptCredential(JSON.stringify(secretsMap)) : null,
        variablesJson: Object.keys(variablesMap).length > 0 ? JSON.stringify(variablesMap) : null,
        services: {
          create: includedServices.map((s) => ({
            name: s.name,
            image: s.image,
            containerName: `${appSlug}_${s.name}`,
            required: !s.optional,
            status: 'DEPLOYING',
          })),
        },
      },
    });

    try {
      onLog?.(`Preparando ${dir}...\n`);
      const mkdir = await this.ssh.runCommand(options, `sudo mkdir -p ${dir}/secrets`, 15_000);
      if (!mkdir.ok) throw new Error(`Falha ao criar diretório no servidor: ${mkdir.stderr || mkdir.message}`);

      onLog?.('Gravando docker-compose.yml...\n');
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, compose, '644');
      if (!write.ok) throw new Error(write.message);

      for (const [serviceName, content] of Object.entries(envFiles)) {
        onLog?.(`Gravando segredos de "${serviceName}"...\n`);
        const writeEnv = await this.ssh.writeRemoteFile(options, `${dir}/secrets/${serviceName}.env`, content, '600');
        if (!writeEnv.ok) throw new Error(writeEnv.message);
      }

      onLog?.(`Garantindo rede ${PROXY_NETWORK}...\n`);
      await this.ssh.runCommand(options, `sudo docker network create ${PROXY_NETWORK} 2>/dev/null || true`, 15_000);

      onLog?.('Subindo os serviços (docker compose up -d)...\n');
      const up = await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${appSlug} up -d`,
        300_000,
        onLog && ((chunk) => onLog(chunk)),
      );
      if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao subir os containers');

      onLog?.('Aguardando os containers ficarem de pé...\n');
      const running = await this.waitForContainers(options, expectedContainers, onLog);
      if (!running) throw new Error('Os containers não ficaram de pé a tempo — confira os logs da aplicação.');

      let domain = null;
      if (dto.domain) {
        onLog?.(`Associando domínio ${dto.domain.hostname}...\n`);
        domain = await this.traefik.createApplicationDomain(serverId, application.id, {
          hostname: dto.domain.hostname,
          serviceName: manifest.primaryService,
          containerName: primaryContainerName(manifest, appSlug),
          containerPort: manifest.primaryPort,
          createDnsRecord: dto.domain.createDnsRecord,
        });
      }

      await this.prisma.application.update({
        where: { id: application.id },
        data: { status: 'RUNNING', containerNames: expectedContainers, lastError: null },
      });
      await this.prisma.projectService.updateMany({ where: { applicationId: application.id }, data: { status: 'RUNNING' } });
      onLog?.('Aplicação implantada com sucesso.\n');
      return { ok: true, applicationId: application.id, domain };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao implantar aplicação';
      await this.prisma.application.update({ where: { id: application.id }, data: { status: 'ERROR', lastError: message } });
      await this.prisma.projectService.updateMany({ where: { applicationId: application.id }, data: { status: 'ERROR' } });
      return { ok: false, applicationId: application.id, error: message };
    }
  }

  private async composeAction(id: string, action: 'start' | 'stop' | 'restart', onLog?: LogFn) {
    const app = await this.getOne(id);
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const result = await this.ssh.runCommand(
      options,
      `cd ${dir} && sudo docker compose -p ${app.slug} ${action}`,
      120_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    const status = !result.ok ? 'ERROR' : action === 'stop' ? 'STOPPED' : 'RUNNING';
    await this.prisma.application.update({
      where: { id },
      data: { status, lastError: result.ok ? null : result.stderr || result.message || null },
    });
    return { ok: result.ok };
  }

  /**
   * `discoverProjectEndpoints` — descobre serviços e portas internas reais de
   * uma aplicação implantada. Fonte primária: o manifesto (autoridade, fomos
   * nós que geramos o compose). Fallback: `docker inspect` no container, pro
   * caso hipotético de um serviço não declarar porta no manifesto.
   */
  async discoverEndpoints(applicationId: string): Promise<EndpointService[]> {
    const app = await this.getOne(applicationId);
    const manifest = this.catalog.getManifest(app.manifestSlug);
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);

    const ps = await this.ssh.runCommand(options, "sudo docker ps -a --format '{{.Names}}|{{.Status}}'", 15_000);
    const statusByName = new Map(
      ps.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const [name, ...rest] = line.split('|');
          return [name, rest.join('|')] as const;
        }),
    );

    const results: EndpointService[] = [];
    for (const service of manifest.services) {
      const containerName = `${app.slug}_${service.name}`;
      const status = statusByName.get(containerName) ?? '';
      const running = status.toLowerCase().includes('up');

      let ports: EndpointPort[] = servicePorts(manifest, service.name).map((p) => ({
        port: p.port,
        protocol: p.protocol ?? 'tcp',
        recommended: !!p.recommended,
        source: 'template',
      }));

      if (ports.length === 0 && running) {
        const inspect = await this.ssh.runCommand(options, `sudo docker inspect ${containerName} --format '{{json .Config.ExposedPorts}}'`, 15_000);
        ports = parseExposedPorts(inspect.stdout).map((p, i) => ({ ...p, recommended: i === 0, source: 'container' as const }));
      }

      results.push({ serviceName: service.name, containerName, image: service.image, running, ports });
    }
    return results;
  }

  /** Cria um domínio pra um serviço específico da aplicação — valida que o
   * serviço e a porta escolhidos existem de verdade antes de mexer no Traefik. */
  async createDomain(applicationId: string, dto: CreateApplicationDomainDto) {
    const app = await this.getOne(applicationId);
    const endpoints = await this.discoverEndpoints(applicationId);
    const service = endpoints.find((e) => e.serviceName === dto.serviceName);
    if (!service) {
      throw new BadRequestException(`Serviço "${dto.serviceName}" não existe nesta aplicação`);
    }
    if (!HOSTNAME_PATTERN.test(dto.hostname)) {
      throw new BadRequestException('Domínio inválido (ex.: app.seudominio.com)');
    }

    return this.traefik.createApplicationDomain(app.serverId, applicationId, {
      hostname: dto.hostname,
      serviceName: dto.serviceName,
      containerName: service.containerName,
      containerPort: dto.port,
      createDnsRecord: dto.createDnsRecord,
    });
  }

  /** Troca o serviço/porta de destino de um domínio já cadastrado. */
  async updateDomain(applicationId: string, domainId: string, dto: CreateApplicationDomainDto) {
    const endpoints = await this.discoverEndpoints(applicationId);
    const service = endpoints.find((e) => e.serviceName === dto.serviceName);
    if (!service) {
      throw new BadRequestException(`Serviço "${dto.serviceName}" não existe nesta aplicação`);
    }
    return this.traefik.updateApplicationDomain(domainId, {
      serviceName: dto.serviceName,
      containerName: service.containerName,
      containerPort: dto.port,
    });
  }

  /** Segredos gerados no deploy (ex.: senha de banco) — decifrados só na hora de mostrar. */
  async getCredentials(applicationId: string): Promise<Record<string, string>> {
    const app = await this.getOne(applicationId);
    if (!app.secretsEnc) return {};
    return JSON.parse(decryptCredential(app.secretsEnc));
  }

  start(id: string, onLog?: LogFn) {
    return this.composeAction(id, 'start', onLog);
  }

  stop(id: string, onLog?: LogFn) {
    return this.composeAction(id, 'stop', onLog);
  }

  restart(id: string, onLog?: LogFn) {
    return this.composeAction(id, 'restart', onLog);
  }

  /** Componentes persistidos do projeto — cada linha é um container real (ver `ProjectService`). */
  async getServices(applicationId: string) {
    await this.getOne(applicationId);
    return this.prisma.projectService.findMany({ where: { applicationId }, orderBy: { createdAt: 'asc' } });
  }

  /** Ação num único serviço do projeto — diferente de `composeAction`, que mexe no projeto inteiro. */
  async serviceAction(applicationId: string, serviceName: string, action: 'start' | 'stop' | 'restart', onLog?: LogFn) {
    const app = await this.getOne(applicationId);
    const service = await this.prisma.projectService.findUnique({
      where: { applicationId_name: { applicationId, name: serviceName } },
    });
    if (!service) throw new NotFoundException(`Serviço "${serviceName}" não existe neste projeto`);

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const result = await this.ssh.runCommand(
      options,
      `cd ${dir} && sudo docker compose -p ${app.slug} ${action} ${serviceName}`,
      120_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    const status = !result.ok ? 'ERROR' : action === 'stop' ? 'STOPPED' : 'RUNNING';
    await this.prisma.projectService.update({ where: { id: service.id }, data: { status } });
    return { ok: result.ok };
  }

  /**
   * Adiciona ao projeto um serviço opcional do manifesto que ainda não foi
   * incluído (ex.: OnlyOffice num Nextcloud já implantado) — reconfigura o
   * compose com o conjunto completo de serviços (obrigatórios + já
   * selecionados + o novo) e sobe só o que faltava; `docker compose up -d`
   * não recria containers cujo config não mudou, então o resto do projeto
   * continua no ar sem interrupção.
   */
  async addService(applicationId: string, serviceName: string, onLog?: LogFn) {
    const app = await this.getOne(applicationId);
    const manifest = this.catalog.getManifest(app.manifestSlug);
    const target = optionalServices(manifest).find((s) => s.name === serviceName);
    if (!target) throw new BadRequestException(`"${serviceName}" não é um serviço opcional deste template`);
    if (app.selectedServices.includes(serviceName)) {
      throw new BadRequestException(`"${serviceName}" já faz parte deste projeto`);
    }

    const newSelected = [...app.selectedServices, serviceName];
    const includedServices = resolveIncludedServices(manifest, newSelected);
    const previouslyIncluded = new Set(resolveIncludedServices(manifest, app.selectedServices).map((s) => s.name));
    const newlyAdded = includedServices.filter((s) => !previouslyIncluded.has(s.name));

    const secretsMap: Record<string, string> = app.secretsEnc ? JSON.parse(decryptCredential(app.secretsEnc)) : {};
    const variablesMap: Record<string, string> = app.variablesJson ? JSON.parse(app.variablesJson) : {};

    const compose = renderCompose(manifest, app.slug, variablesMap, newSelected);
    const envFiles = renderServiceEnvFiles(manifest, app.slug, secretsMap, variablesMap, newSelected);
    const dir = appDir(app.slug);
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);

    await this.prisma.projectService.createMany({
      data: newlyAdded.map((s) => ({
        applicationId,
        name: s.name,
        image: s.image,
        containerName: `${app.slug}_${s.name}`,
        required: !s.optional,
        status: 'DEPLOYING' as const,
      })),
      skipDuplicates: true,
    });

    try {
      onLog?.('Gravando docker-compose.yml atualizado...\n');
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, compose, '644');
      if (!write.ok) throw new Error(write.message);

      for (const [svcName, content] of Object.entries(envFiles)) {
        onLog?.(`Gravando segredos de "${svcName}"...\n`);
        const writeEnv = await this.ssh.writeRemoteFile(options, `${dir}/secrets/${svcName}.env`, content, '600');
        if (!writeEnv.ok) throw new Error(writeEnv.message);
      }

      onLog?.('Subindo o novo serviço (docker compose up -d)...\n');
      const up = await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${app.slug} up -d`,
        300_000,
        onLog && ((chunk) => onLog(chunk)),
      );
      if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao subir o novo serviço');

      onLog?.('Aguardando o novo serviço ficar de pé...\n');
      const expectedNew = newlyAdded.map((s) => `${app.slug}_${s.name}`);
      const running = await this.waitForContainers(options, expectedNew, onLog);
      if (!running) throw new Error('O novo serviço não ficou de pé a tempo — confira os logs.');

      await this.prisma.application.update({
        where: { id: applicationId },
        data: {
          selectedServices: newSelected,
          containerNames: includedServices.map((s) => `${app.slug}_${s.name}`),
          status: 'RUNNING',
          lastError: null,
        },
      });
      await this.prisma.projectService.updateMany({
        where: { applicationId, name: { in: newlyAdded.map((s) => s.name) } },
        data: { status: 'RUNNING' },
      });
      onLog?.('Serviço adicionado com sucesso.\n');
      return { ok: true, applicationId, serviceName };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao adicionar serviço';
      await this.prisma.projectService.updateMany({
        where: { applicationId, name: { in: newlyAdded.map((s) => s.name) } },
        data: { status: 'ERROR' },
      });
      await this.prisma.application.update({ where: { id: applicationId }, data: { lastError: message } });
      return { ok: false, applicationId, error: message };
    }
  }

  async remove(id: string, onLog?: LogFn) {
    const app = await this.getOne(id);
    await this.prisma.application.update({ where: { id }, data: { status: 'REMOVING' } });
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);

    onLog?.('Removendo containers e volumes da aplicação...\n');
    await this.ssh.runCommand(options, `cd ${dir} && sudo docker compose -p ${app.slug} down -v`, 120_000, onLog && ((chunk) => onLog(chunk)));

    onLog?.(`Removendo diretório ${dir}...\n`);
    await this.ssh.runCommand(options, `sudo rm -rf ${dir}`, 15_000);

    for (const domain of app.domains) {
      await this.traefik.deleteDomain(domain.id).catch(() => undefined);
    }

    await this.prisma.application.delete({ where: { id } });
    return { ok: true };
  }
}
