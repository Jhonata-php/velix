import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { unlink } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { TraefikService } from '../traefik/traefik.service';
import { CatalogService } from '../catalog/catalog.service';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { dbImportSecretKey, dbImportCommand } from '../terminal/container-shell.util';
import { shellSingleQuote } from '../database/mysql.util';
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
import { appDir, allContainersUp, parseExposedPorts, slugify, mergeComposeFragments } from './applications.util';
import { DeployServiceDto } from './dto/deploy-service.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateApplicationDomainDto } from './dto/create-application-domain.dto';
import { consumeSqlImportUpload } from './sql-import-uploads.util';

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
    return this.prisma.application.findMany({
      where: { serverId },
      orderBy: { deployedAt: 'desc' },
      include: { domains: true, deployments: { select: { sourceType: true, manifestSlug: true } } },
    });
  }

  /** Todos os projetos de todos os servidores — a visão que faltava pra
   * responder "o que eu tenho instalado?" sem abrir servidor por servidor. */
  async listAll() {
    return this.prisma.application.findMany({
      orderBy: { deployedAt: 'desc' },
      include: {
        domains: true,
        server: { select: { id: true, name: true, isLocal: true } },
        deployments: { select: { sourceType: true, manifestSlug: true } },
      },
    });
  }

  async getOne(id: string) {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: {
        domains: true,
        services: true,
        server: { select: { id: true, name: true, isLocal: true } },
        // Sem secretsEnc/repoTokenEnc/webhookSecret: são segredos (o
        // webhookSecret nem é cifrado) que não precisam sair deste endpoint —
        // quem realmente usa cada um tem sua própria rota dedicada
        // (getCredentials, getAutoDeploy) que exige autenticação e devolve só
        // o que aquela tela específica precisa.
        deployments: {
          select: {
            id: true,
            applicationId: true,
            sourceType: true,
            manifestSlug: true,
            manifestVersion: true,
            selectedServices: true,
            repoUrl: true,
            gitRef: true,
            buildMethod: true,
            dockerfilePath: true,
            gitAccountId: true,
            autoDeploy: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!app) throw new NotFoundException('Projeto não encontrado');
    return app;
  }

  private async uniqueSlug(name: string) {
    const base = slugify(name);
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = await this.prisma.application.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Não foi possível gerar um identificador único para o projeto — tente outro nome.');
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

  /** Compose final do projeto: merge dos composes já renderizados de todas as
   * suas implantações (ver `mergeComposeFragments`). É sempre isso que vai pro
   * `docker-compose.yml` do servidor — nunca só o de uma implantação, senão
   * `docker compose up -d` reconciliaria embora os serviços das outras
   * implantações (ausentes desse compose parcial) fossem removidos. */
  private async mergedComposeExcluding(applicationId: string, excludeDeploymentId?: string) {
    const deployments = await this.prisma.projectDeployment.findMany({
      where: { applicationId, ...(excludeDeploymentId ? { id: { not: excludeDeploymentId } } : {}) },
    });
    return mergeComposeFragments(deployments.map((d) => d.composeRendered));
  }

  /** Cria um projeto vazio — sem SSH, sem Docker, só a linha no banco. Os
   * serviços entram depois, um a um, via `deployManifestIntoProject`/`GitDeployService`. */
  async createProject(dto: CreateProjectDto) {
    const { server } = await this.servers.getServerWithConnectOptions(dto.serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de criar um projeto');
    }
    if (!dto.name?.trim() || dto.name.trim().length < 2) {
      throw new BadRequestException('Informe um nome válido para o projeto');
    }

    const slug = await this.uniqueSlug(dto.name);
    return this.prisma.application.create({
      data: {
        serverId: dto.serverId,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        environment: dto.environment,
        tags: dto.tags ?? [],
      },
    });
  }

  /**
   * Implanta um manifesto do catálogo como um serviço novo dentro de um
   * projeto já existente: renderiza o compose dessa implantação, junta com o
   * das demais implantações do projeto, envia pro servidor, sobe via
   * `docker compose up`, confere os containers e, se um domínio foi pedido,
   * associa a rota no Traefik. Qualquer falha marca o projeto como ERROR (ele
   * continua existindo — nada fica implantado sem rastro, pra o usuário poder
   * ver o que deu errado e tentar de novo).
   */
  async deployManifestIntoProject(applicationId: string, dto: DeployServiceDto, onLog?: LogFn) {
    const application = await this.getOne(applicationId);
    const { server, options } = await this.servers.getServerWithConnectOptions(application.serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de implantar serviços');
    }
    if (dto.domain) {
      if (!server.traefikInstalled) {
        throw new BadRequestException('Instale o Traefik neste servidor antes de associar um domínio ao serviço');
      }
      // Revalidado aqui (não só no DTO) porque esse método também é chamado via
      // o WebSocket /ops, que não passa pelo ValidationPipe do Nest.
      if (!HOSTNAME_PATTERN.test(dto.domain.hostname)) {
        throw new BadRequestException('Domínio inválido (ex.: app.seudominio.com)');
      }
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

    const slug = application.slug;
    const selectedServices = dto.selectedServices ?? [];
    const secretsMap = resolveSecrets(manifest, dto.secrets);
    const variablesMap = resolveVariables(manifest, dto.variables);
    const deploymentCompose = renderCompose(manifest, slug, variablesMap, selectedServices);
    const envFiles = renderServiceEnvFiles(manifest, slug, secretsMap, variablesMap, selectedServices);
    const dir = appDir(slug);
    const includedServices = resolveIncludedServices(manifest, selectedServices);
    const expectedContainers = includedServices.map((s) => `${slug}_${s.name}`);

    // `ProjectService` tem @@unique([applicationId, name]) — sem esta checagem,
    // reimplantar um manifesto cujo nome de serviço já existe neste projeto
    // (ex.: clicar de novo em "Abrir interface web" do Adminer) derrubava a
    // "Unique constraint failed" crua do Prisma direto na tela do usuário.
    const existing = await this.prisma.projectService.findMany({ where: { applicationId }, select: { name: true } });
    const existingNames = new Set(existing.map((s) => s.name));
    const conflict = includedServices.find((s) => existingNames.has(s.name));
    if (conflict) {
      throw new BadRequestException(`Já existe um serviço chamado "${conflict.name}" neste projeto.`);
    }

    const deployment = await this.prisma.projectDeployment.create({
      data: {
        applicationId,
        sourceType: 'catalog',
        manifestSlug: manifest.slug,
        manifestVersion: manifest.version,
        selectedServices,
        secretsEnc: Object.keys(secretsMap).length > 0 ? encryptCredential(JSON.stringify(secretsMap)) : null,
        variablesJson: Object.keys(variablesMap).length > 0 ? JSON.stringify(variablesMap) : null,
        composeRendered: deploymentCompose,
        services: {
          create: includedServices.map((s) => ({
            applicationId,
            name: s.name,
            image: s.image,
            containerName: `${slug}_${s.name}`,
            required: !s.optional,
            status: 'DEPLOYING',
          })),
        },
      },
    });

    const mergedCompose = await this.mergedComposeExcluding(applicationId);
    await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'DEPLOYING', composeRendered: mergedCompose } });

    try {
      onLog?.(`Preparando ${dir}...\n`);
      const mkdir = await this.ssh.runCommand(options, `sudo mkdir -p ${dir}/secrets`, 15_000);
      if (!mkdir.ok) throw new Error(`Falha ao criar diretório no servidor: ${mkdir.stderr || mkdir.message}`);

      onLog?.('Gravando docker-compose.yml...\n');
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
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
        `cd ${dir} && sudo docker compose -p ${slug} up -d`,
        300_000,
        onLog && ((chunk) => onLog(chunk)),
      );
      if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao subir os containers');

      onLog?.('Aguardando os containers ficarem de pé...\n');
      const running = await this.waitForContainers(options, expectedContainers, onLog);
      if (!running) throw new Error('Os containers não ficaram de pé a tempo — confira os logs do serviço.');

      let domain = null;
      if (dto.domain) {
        onLog?.(`Associando domínio ${dto.domain.hostname}...\n`);
        domain = await this.traefik.createApplicationDomain(application.serverId, applicationId, {
          hostname: dto.domain.hostname,
          serviceName: manifest.primaryService,
          containerName: primaryContainerName(manifest, slug),
          containerPort: manifest.primaryPort,
          createDnsRecord: dto.domain.createDnsRecord,
        });
      }

      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'RUNNING', containerNames: [...application.containerNames, ...expectedContainers], lastError: null },
      });
      await this.prisma.projectService.updateMany({ where: { deploymentId: deployment.id }, data: { status: 'RUNNING' } });
      onLog?.('Serviço implantado com sucesso.\n');
      return { ok: true, applicationId, deploymentId: deployment.id, domain };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao implantar o serviço';
      await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'ERROR', lastError: message } });
      await this.prisma.projectService.updateMany({ where: { deploymentId: deployment.id }, data: { status: 'ERROR' } });
      return { ok: false, applicationId, deploymentId: deployment.id, error: message };
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
   * um projeto implantado, olhando cada implantação (manifesto ou Git) que o
   * compõe. Fonte primária: o manifesto de cada implantação (autoridade, fomos
   * nós que geramos o compose). Fallback: `docker inspect` no container, pro
   * caso hipotético de um serviço não declarar porta no manifesto (é sempre o
   * caso de serviços vindos de Git, que não têm manifesto).
   */
  async discoverEndpoints(applicationId: string): Promise<EndpointService[]> {
    const app = await this.getOne(applicationId);
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
    for (const service of app.services) {
      const status = statusByName.get(service.containerName) ?? '';
      const running = status.toLowerCase().includes('up');
      const deployment = app.deployments.find((d) => d.id === service.deploymentId);

      let ports: EndpointPort[] = [];
      if (deployment?.manifestSlug) {
        const manifest = this.catalog.getManifest(deployment.manifestSlug);
        ports = servicePorts(manifest, service.name).map((p) => ({
          port: p.port,
          protocol: p.protocol ?? 'tcp',
          recommended: !!p.recommended,
          source: 'template',
        }));
      }

      if (ports.length === 0 && running) {
        const inspect = await this.ssh.runCommand(options, `sudo docker inspect ${service.containerName} --format '{{json .Config.ExposedPorts}}'`, 15_000);
        ports = parseExposedPorts(inspect.stdout).map((p, i) => ({ ...p, recommended: i === 0, source: 'container' as const }));
      }

      results.push({ serviceName: service.name, containerName: service.containerName, image: service.image, running, ports });
    }
    return results;
  }

  /** Cria um domínio pra um serviço específico do projeto — valida que o
   * serviço e a porta escolhidos existem de verdade antes de mexer no Traefik. */
  async createDomain(applicationId: string, dto: CreateApplicationDomainDto) {
    const app = await this.getOne(applicationId);
    const endpoints = await this.discoverEndpoints(applicationId);
    const service = endpoints.find((e) => e.serviceName === dto.serviceName);
    if (!service) {
      throw new BadRequestException(`Serviço "${dto.serviceName}" não existe neste projeto`);
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
      throw new BadRequestException(`Serviço "${dto.serviceName}" não existe neste projeto`);
    }
    return this.traefik.updateApplicationDomain(domainId, {
      serviceName: dto.serviceName,
      containerName: service.containerName,
      containerPort: dto.port,
    });
  }

  /** Segredos gerados no deploy de uma implantação (ex.: senha de banco) —
   * decifrados só na hora de mostrar. */
  async getCredentials(deploymentId: string): Promise<Record<string, string>> {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (!deployment.secretsEnc) return {};
    return JSON.parse(decryptCredential(deployment.secretsEnc));
  }

  /** Variáveis de ambiente não sensíveis de uma implantação vinda de
   * repositório — editáveis pelo usuário depois do deploy inicial (ver
   * `GitDeployService.updateEnv`). Implantações do catálogo não usam isto
   * aqui (as variáveis delas vêm do manifesto, editadas de outro jeito). */
  async getEnv(deploymentId: string): Promise<Record<string, string>> {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (!deployment.variablesJson) return {};
    return JSON.parse(deployment.variablesJson);
  }

  /** Riscos de segurança do manifesto de uma implantação — calculados a partir
   * do mesmo manifesto usado no deploy, não de nada guardado à parte. */
  async getSecurityRisks(deploymentId: string) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (!deployment.manifestSlug) return { risks: [], highest: 'none' as const };
    const manifest = this.catalog.getManifest(deployment.manifestSlug);
    const risks = scanSecurityRisks(manifest);
    return { risks, highest: highestRiskLevel(risks) };
  }

  /** CPU/memória/rede ao vivo de um container — `docker stats --no-stream`,
   * mesmo padrão de `discoverEndpoints` (que já roda `docker ps`/`docker
   * inspect` pra essa mesma finalidade de leitura pontual, sem stream). */
  async getServiceStats(applicationId: string, serviceName: string) {
    const app = await this.getOne(applicationId);
    const service = app.services.find((s) => s.name === serviceName);
    if (!service) throw new NotFoundException(`Serviço "${serviceName}" não existe neste projeto`);

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const result = await this.ssh.runCommand(
      options,
      `sudo docker stats --no-stream --format '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}' ${service.containerName}`,
      15_000,
    );
    const [cpu, memory, network] = result.stdout.trim().split('|');
    return { cpu: cpu ?? null, memory: memory ?? null, network: network ?? null };
  }

  /**
   * Importa um dump `.sql` pro banco de um serviço (Postgres/MySQL/MariaDB —
   * ver dbImportSecretKey/dbImportCommand pra escopo). Grava o conteúdo num
   * arquivo temporário no SERVIDOR (não dentro do container — `docker exec`
   * não enxerga o filesystem do host) e usa `< arquivo` na hora de rodar o
   * `docker exec`: o redirecionamento é interpretado pelo shell do host antes
   * de existir qualquer container, então o conteúdo chega no stdin do
   * processo dentro do container sem precisar montar volume nenhum.
   */
  async importDatabase(applicationId: string, serviceName: string, uploadId: string, onLog?: LogFn) {
    const app = await this.getOne(applicationId);
    const service = app.services.find((s) => s.name === serviceName);
    if (!service) throw new NotFoundException(`Serviço "${serviceName}" não existe neste projeto`);

    const secretKey = dbImportSecretKey(service.image);
    if (!secretKey) throw new BadRequestException('Importação de .sql não é suportada para este tipo de serviço');

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    if (!deployment?.secretsEnc) throw new BadRequestException('Não achei a senha deste banco — a implantação não gerou segredos.');
    const secretsMap = JSON.parse(decryptCredential(deployment.secretsEnc)) as Record<string, string>;
    const password = secretsMap[secretKey];
    if (!password) throw new BadRequestException(`Segredo "${secretKey}" não encontrado nesta implantação.`);

    const variablesMap = deployment.variablesJson ? (JSON.parse(deployment.variablesJson) as Record<string, string>) : {};
    const dbName = variablesMap.DATABASE_NAME || 'app';

    const importInfo = dbImportCommand(service.image, password, dbName);
    if (!importInfo) throw new BadRequestException('Importação de .sql não é suportada para este tipo de serviço');

    const localPath = consumeSqlImportUpload(uploadId);
    if (!localPath) throw new BadRequestException('Upload do arquivo expirou ou já foi usado — selecione o .sql de novo.');

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const remoteFilePath = `${dir}/.import-${randomBytes(6).toString('hex')}.sql`;

    try {
      onLog?.('Enviando o arquivo pro servidor...\n');
      const write = await this.ssh.uploadFile(options, localPath, remoteFilePath);
      if (!write.ok) throw new BadRequestException(write.message);

      try {
        onLog?.('Importando...\n');
        const result = await this.ssh.runCommand(
          options,
          `sudo docker exec ${importInfo.execFlags} -i ${shellSingleQuote(service.containerName)} ${importInfo.command} < ${remoteFilePath}`,
          600_000,
          onLog && ((chunk) => onLog(chunk)),
        );
        if (!result.ok) throw new Error(result.stderr || result.message || 'Falha ao importar — confira o log acima.');
        onLog?.('Importação concluída.\n');
        return { ok: true };
      } finally {
        await this.ssh.runCommand(options, `sudo rm -f ${remoteFilePath}`, 15_000);
      }
    } finally {
      await unlink(localPath).catch(() => {});
    }
  }

  /**
   * Publica (ou remove) a porta do host mapeada pro container de um serviço
   * do catálogo — pra conectar um cliente de fora (DBeaver, TablePlus...)
   * sem passar pelo Traefik, que só roteia HTTP/HTTPS. `hostPort: null`
   * remove a publicação, voltando o serviço a só existir na rede interna.
   *
   * Só serviços do catálogo (deployment.manifestSlug) — precisa re-renderizar
   * o compose a partir do manifesto pra acrescentar o `ports:`, o mesmo
   * mecanismo que `addService` já usa pra reconfigurar uma implantação
   * existente sem derrubar o resto do projeto.
   */
  async setPublishedPort(applicationId: string, serviceName: string, hostPort: number | null, onLog?: LogFn) {
    if (hostPort !== null && (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535)) {
      throw new BadRequestException('Porta inválida');
    }

    const app = await this.getOne(applicationId);
    const service = app.services.find((s) => s.name === serviceName);
    if (!service) throw new NotFoundException(`Serviço "${serviceName}" não existe neste projeto`);

    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: service.deploymentId } });
    if (!deployment?.manifestSlug) throw new BadRequestException('Publicar porta só é suportado para serviços implantados do catálogo');

    const manifest = this.catalog.getManifest(deployment.manifestSlug);
    const variablesMap: Record<string, string> = deployment.variablesJson ? JSON.parse(deployment.variablesJson) : {};
    const hostPorts = hostPort ? { [serviceName]: hostPort } : {};
    const deploymentCompose = renderCompose(manifest, app.slug, variablesMap, deployment.selectedServices, hostPorts);

    await this.prisma.projectDeployment.update({ where: { id: deployment.id }, data: { composeRendered: deploymentCompose } });
    const mergedCompose = await this.mergedComposeExcluding(applicationId);

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);

    onLog?.('Gravando docker-compose.yml...\n');
    const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
    if (!write.ok) throw new BadRequestException(write.message);

    onLog?.('Recriando o container...\n');
    const up = await this.ssh.runCommand(
      options,
      `cd ${dir} && sudo docker compose -p ${app.slug} up -d`,
      120_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao recriar o container — a porta pode já estar em uso.');

    await this.prisma.projectService.update({ where: { id: service.id }, data: { publishedPort: hostPort } });
    await this.prisma.application.update({ where: { id: applicationId }, data: { composeRendered: mergedCompose } });

    return { ok: true, publishedPort: hostPort };
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
   * Adiciona à implantação um serviço opcional do manifesto que ainda não foi
   * incluído (ex.: OnlyOffice num Nextcloud já implantado) — reconfigura o
   * compose DESSA implantação com o conjunto completo de serviços
   * (obrigatórios + já selecionados + o novo), regrava o compose merged do
   * projeto inteiro e sobe só o que faltava; `docker compose up -d` não
   * recria containers cujo config não mudou, então o resto do projeto
   * continua no ar sem interrupção.
   */
  async addService(deploymentId: string, serviceName: string, onLog?: LogFn) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (!deployment.manifestSlug) throw new BadRequestException('Esta implantação não veio do catálogo — não tem serviços opcionais');
    const app = await this.getOne(deployment.applicationId);
    const manifest = this.catalog.getManifest(deployment.manifestSlug);
    const target = optionalServices(manifest).find((s) => s.name === serviceName);
    if (!target) throw new BadRequestException(`"${serviceName}" não é um serviço opcional deste template`);
    if (deployment.selectedServices.includes(serviceName)) {
      throw new BadRequestException(`"${serviceName}" já faz parte deste projeto`);
    }

    const newSelected = [...deployment.selectedServices, serviceName];
    const includedServices = resolveIncludedServices(manifest, newSelected);
    const previouslyIncluded = new Set(resolveIncludedServices(manifest, deployment.selectedServices).map((s) => s.name));
    const newlyAdded = includedServices.filter((s) => !previouslyIncluded.has(s.name));

    const secretsMap: Record<string, string> = deployment.secretsEnc ? JSON.parse(decryptCredential(deployment.secretsEnc)) : {};
    const variablesMap: Record<string, string> = deployment.variablesJson ? JSON.parse(deployment.variablesJson) : {};

    const deploymentCompose = renderCompose(manifest, app.slug, variablesMap, newSelected);
    const envFiles = renderServiceEnvFiles(manifest, app.slug, secretsMap, variablesMap, newSelected);
    const dir = appDir(app.slug);
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);

    await this.prisma.projectDeployment.update({ where: { id: deploymentId }, data: { composeRendered: deploymentCompose } });
    await this.prisma.projectService.createMany({
      data: newlyAdded.map((s) => ({
        applicationId: deployment.applicationId,
        deploymentId,
        name: s.name,
        image: s.image,
        containerName: `${app.slug}_${s.name}`,
        required: !s.optional,
        status: 'DEPLOYING' as const,
      })),
      skipDuplicates: true,
    });

    const mergedCompose = await this.mergedComposeExcluding(deployment.applicationId);

    try {
      onLog?.('Gravando docker-compose.yml atualizado...\n');
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
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

      await this.prisma.projectDeployment.update({ where: { id: deploymentId }, data: { selectedServices: newSelected } });
      await this.prisma.application.update({
        where: { id: deployment.applicationId },
        data: {
          containerNames: [...app.containerNames, ...expectedNew],
          composeRendered: mergedCompose,
          status: 'RUNNING',
          lastError: null,
        },
      });
      await this.prisma.projectService.updateMany({
        where: { deploymentId, name: { in: newlyAdded.map((s) => s.name) } },
        data: { status: 'RUNNING' },
      });
      onLog?.('Serviço adicionado com sucesso.\n');
      return { ok: true, applicationId: deployment.applicationId, serviceName };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao adicionar serviço';
      await this.prisma.projectService.updateMany({
        where: { deploymentId, name: { in: newlyAdded.map((s) => s.name) } },
        data: { status: 'ERROR' },
      });
      await this.prisma.application.update({ where: { id: deployment.applicationId }, data: { lastError: message } });
      return { ok: false, applicationId: deployment.applicationId, error: message };
    }
  }

  /**
   * Remove UMA implantação do projeto (ex.: tirar o Postgres avulso, mantendo
   * o resto no ar) — derruba só os containers dela e regrava o compose do
   * projeto sem essa implantação; diferente de `remove`, que apaga o projeto
   * inteiro.
   */
  async removeService(applicationId: string, deploymentId: string, onLog?: LogFn) {
    const app = await this.getOne(applicationId);
    const deployment = app.deployments.find((d) => d.id === deploymentId);
    if (!deployment) throw new NotFoundException('Implantação não encontrada neste projeto');
    const services = app.services.filter((s) => s.deploymentId === deploymentId);

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const serviceNames = services.map((s) => s.name).join(' ');

    onLog?.('Removendo os containers deste serviço...\n');
    if (serviceNames) {
      await this.ssh.runCommand(options, `cd ${dir} && sudo docker compose -p ${app.slug} rm -sf ${serviceNames}`, 60_000, onLog && ((chunk) => onLog(chunk)));
    }

    const mergedCompose = await this.mergedComposeExcluding(applicationId, deploymentId);
    onLog?.('Gravando docker-compose.yml sem este serviço...\n');
    const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
    if (!write.ok) throw new Error(write.message);

    if (mergedCompose.trim()) {
      await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${app.slug} up -d --remove-orphans`,
        120_000,
        onLog && ((chunk) => onLog(chunk)),
      );
    }

    await this.prisma.projectDeployment.delete({ where: { id: deploymentId } });
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        composeRendered: mergedCompose,
        containerNames: app.containerNames.filter((name) => !services.some((s) => s.containerName === name)),
      },
    });

    onLog?.('Serviço removido.\n');
    return { ok: true };
  }

  async remove(id: string, onLog?: LogFn) {
    const app = await this.getOne(id);
    await this.prisma.application.update({ where: { id }, data: { status: 'REMOVING' } });
    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);

    if (app.services.length > 0) {
      onLog?.('Removendo containers e volumes do projeto...\n');
      await this.ssh.runCommand(options, `cd ${dir} && sudo docker compose -p ${app.slug} down -v`, 120_000, onLog && ((chunk) => onLog(chunk)));
    }

    onLog?.(`Removendo diretório ${dir}...\n`);
    await this.ssh.runCommand(options, `sudo rm -rf ${dir}`, 15_000);

    for (const domain of app.domains) {
      await this.traefik.deleteDomain(domain.id).catch(() => undefined);
    }

    await this.prisma.application.delete({ where: { id } });
    return { ok: true };
  }
}
