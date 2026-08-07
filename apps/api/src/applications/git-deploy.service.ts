import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { TraefikService } from '../traefik/traefik.service';
import { GitAccountsService } from '../git-accounts/git-accounts.service';
import { randomBytes } from 'crypto';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { PROXY_NETWORK } from '../traefik/traefik.util';
import { appDir, allContainersUp, slugify } from './applications.util';
import {
  validateRepoUrl,
  validateGitRef,
  validateDockerfilePath,
  cloneUrlWithToken,
  redactToken,
  renderGitCompose,
  type BuildMethod,
} from './git-source.util';

type LogFn = (line: string) => void;

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export interface DeployFromGitInput {
  name: string;
  description?: string;
  environment?: 'PRODUCTION' | 'STAGING' | 'DEVELOPMENT' | 'LAB';
  tags?: string[];
  repoUrl: string;
  gitRef?: string;
  buildMethod: BuildMethod;
  dockerfilePath?: string;
  token?: string;
  /** Conta salva em Configurações — alternativa a digitar o token aqui. */
  gitAccountId?: string;
  autoDeploy?: boolean;
  port: number;
  env?: Record<string, string>;
  volumes?: { name: string; containerPath: string }[];
  domain?: { hostname: string; createDnsRecord?: boolean };
}

/**
 * Implantação a partir do código do usuário, em vez de um manifesto curado.
 *
 * A diferença mora só no começo: em vez de puxar uma imagem de registro, o
 * servidor clona o repositório e constrói a imagem ali mesmo. Do compose em
 * diante o caminho é o mesmo do catálogo — inclusive Traefik e domínio.
 *
 * Construir código arbitrário é uma superfície diferente da do catálogo: um
 * Dockerfile roda o que quiser durante o build, com o Docker do servidor de
 * destino. Isso é inerente ao recurso (é o que "implantar meu projeto"
 * significa), e a defesa está em não deixar a *entrada* virar execução: URL só
 * https de forjas conhecidas, ref e caminho validados por lista de caracteres,
 * e nada disso interpolado sem passar por essa checagem — ver git-source.util.
 */
@Injectable()
export class GitDeployService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ssh: SshService,
    private readonly servers: ServersService,
    private readonly traefik: TraefikService,
    private readonly gitAccounts: GitAccountsService,
  ) {}

  private async uniqueSlug(name: string) {
    const base = slugify(name);
    for (let i = 0; i < 6; i++) {
      const candidate = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      const exists = await this.prisma.application.findUnique({ where: { slug: candidate } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Não foi possível gerar um identificador único — tente outro nome.');
  }

  private async waitForContainer(options: SshConnectOptions, name: string, onLog?: LogFn, attempts = 20, delayMs = 3000) {
    for (let i = 0; i < attempts; i++) {
      const check = await this.ssh.runCommand(options, "sudo docker ps --format '{{.Names}}|{{.Status}}'", 15_000);
      if (allContainersUp(check.stdout, [name])) return true;
      onLog?.(`Ainda subindo... (tentativa ${i + 1}/${attempts})\n`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  }

  /** Nixpacks não vem com o Docker — instalado sob demanda, só quando escolhido. */
  private async ensureNixpacks(options: SshConnectOptions, onLog?: LogFn) {
    const check = await this.ssh.runCommand(options, 'command -v nixpacks', 15_000);
    if (check.ok && check.stdout.trim()) {
      onLog?.('Nixpacks já instalado.\n');
      return;
    }
    onLog?.('Instalando o Nixpacks no servidor...\n');
    const install = await this.ssh.runCommand(
      options,
      'curl -sSL https://nixpacks.com/install.sh | sudo bash',
      300_000,
      onLog && ((chunk) => onLog(chunk)),
    );
    if (!install.ok) throw new Error('Falha ao instalar o Nixpacks no servidor');
  }

  async deploy(serverId: string, dto: DeployFromGitInput, onLog?: LogFn) {
    const { server, options } = await this.servers.getServerWithConnectOptions(serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de implantar aplicações');
    }
    if (!dto.name?.trim() || dto.name.trim().length < 2) {
      throw new BadRequestException('Informe um nome válido para a aplicação');
    }

    const repo = validateRepoUrl(dto.repoUrl ?? '');
    if (!repo.ok) throw new BadRequestException(repo.error);

    const gitRef = (dto.gitRef ?? 'main').trim() || 'main';
    if (!validateGitRef(gitRef)) throw new BadRequestException('Branch, tag ou commit inválido');

    if (dto.buildMethod !== 'dockerfile' && dto.buildMethod !== 'nixpacks') {
      throw new BadRequestException('Método de build inválido');
    }
    const dockerfilePath = (dto.dockerfilePath ?? 'Dockerfile').trim() || 'Dockerfile';
    if (dto.buildMethod === 'dockerfile' && !validateDockerfilePath(dockerfilePath)) {
      throw new BadRequestException('Caminho do Dockerfile inválido');
    }

    const port = Number(dto.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('Informe a porta que a aplicação escuta dentro do container');
    }

    if (dto.domain) {
      if (!server.traefikInstalled) {
        throw new BadRequestException('Instale o Traefik neste servidor antes de associar um domínio');
      }
      if (!HOSTNAME_PATTERN.test(dto.domain.hostname)) {
        throw new BadRequestException('Domínio inválido (ex.: app.seudominio.com)');
      }
    }

    // Conta salva tem precedência sobre token avulso: se o usuário escolheu uma,
    // é ela que ele espera que seja usada.
    const token = dto.gitAccountId ? await this.gitAccounts.resolveToken(dto.gitAccountId) : dto.token;

    const slug = await this.uniqueSlug(dto.name);
    const dir = appDir(slug);
    const repoDir = `${dir}/repo`;
    const image = `velix/${slug}:latest`;
    const container = `${slug}_app`;
    const volumes = dto.volumes ?? [];
    const env = dto.env ?? {};

    const compose = renderGitCompose({ slug, image, port, env, volumes, proxyNetwork: PROXY_NETWORK });

    // Toda linha de log passa por aqui: o token vai embutido na URL de clone e
    // o git costuma ecoá-la em mensagens de erro.
    const log: LogFn | undefined = onLog && ((line: string) => onLog(redactToken(line, token)));

    const application = await this.prisma.application.create({
      data: {
        serverId,
        name: dto.name.trim(),
        slug,
        description: dto.description,
        environment: dto.environment ?? 'PRODUCTION',
        tags: dto.tags ?? [],
        sourceType: 'git',
        repoUrl: repo.url,
        gitRef,
        buildMethod: dto.buildMethod,
        dockerfilePath: dto.buildMethod === 'dockerfile' ? dockerfilePath : null,
        gitAccountId: dto.gitAccountId ?? null,
        repoTokenEnc: !dto.gitAccountId && dto.token?.trim() ? encryptCredential(dto.token.trim()) : null,
        autoDeploy: dto.autoDeploy ?? false,
        // 32 bytes de aleatoriedade: é o que autentica o webhook, então precisa
        // ser impossível de adivinhar. Gerado sempre — ligar o autodeploy depois
        // não deve exigir reimplantar.
        webhookSecret: randomBytes(24).toString('base64url'),
        // Um repositório não tem manifesto; o slug identifica a origem e a
        // "versão" é o ref pedido. Mantém as telas existentes funcionando sem
        // colunas nulas espalhadas.
        manifestSlug: 'git',
        manifestVersion: gitRef,
        status: 'DEPLOYING',
        composeRendered: compose,
        containerNames: [container],
        services: { create: [{ name: 'app', image, containerName: container, required: true, status: 'DEPLOYING' }] },
      },
    });

    try {
      log?.(`Preparando ${dir}...\n`);
      const mkdir = await this.ssh.runCommand(options, `sudo rm -rf ${repoDir} && sudo mkdir -p ${dir}`, 30_000);
      if (!mkdir.ok) throw new Error(`Falha ao criar diretório: ${mkdir.stderr || mkdir.message}`);

      log?.(`Clonando ${repo.url} (${gitRef})...\n`);
      const cloneUrl = cloneUrlWithToken(repo.url, token);
      // --depth 1: só o estado do ref pedido. Histórico completo não serve pra
      // nada aqui e em repositório grande é a diferença entre segundos e minutos.
      const clone = await this.ssh.runCommand(
        options,
        `sudo git clone --depth 1 --branch '${gitRef}' '${cloneUrl}' ${repoDir}`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!clone.ok) {
        throw new Error(
          'Falha ao clonar o repositório. Confira a URL, a branch e — se for privado — o token de acesso.',
        );
      }

      if (dto.buildMethod === 'dockerfile') {
        const check = await this.ssh.runCommand(options, `sudo test -f ${repoDir}/${dockerfilePath} && echo yes`, 15_000);
        if (!check.stdout.includes('yes')) {
          throw new Error(`O repositório não tem "${dockerfilePath}". Aponte o caminho certo ou use o Nixpacks.`);
        }
        log?.(`Construindo a imagem com ${dockerfilePath}...\n`);
        const build = await this.ssh.runCommand(
          options,
          `cd ${repoDir} && sudo docker build -f ${dockerfilePath} -t ${image} .`,
          1_800_000,
          log && ((chunk) => log(chunk)),
        );
        if (!build.ok) throw new Error('Falha ao construir a imagem — veja o log do build acima.');
      } else {
        await this.ensureNixpacks(options, log);
        log?.('Construindo a imagem com o Nixpacks (detecção automática de linguagem)...\n');
        const build = await this.ssh.runCommand(
          options,
          `cd ${repoDir} && sudo nixpacks build . --name ${image}`,
          1_800_000,
          log && ((chunk) => log(chunk)),
        );
        if (!build.ok) throw new Error('Falha ao construir com o Nixpacks — veja o log acima.');
      }

      log?.('Gravando docker-compose.yml...\n');
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, compose, '644');
      if (!write.ok) throw new Error(write.message);

      log?.(`Garantindo rede ${PROXY_NETWORK}...\n`);
      await this.ssh.runCommand(options, `sudo docker network create ${PROXY_NETWORK} 2>/dev/null || true`, 15_000);

      log?.('Subindo o serviço...\n');
      const up = await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${slug} up -d`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao subir o container');

      log?.('Aguardando o container ficar de pé...\n');
      const running = await this.waitForContainer(options, container, log);
      if (!running) throw new Error('O container não ficou de pé a tempo — confira o log da aplicação.');

      let domain = null;
      if (dto.domain) {
        log?.(`Associando domínio ${dto.domain.hostname}...\n`);
        // createApplicationDomain (e não createDomain): a rota aponta pro nome
        // do container na rede do proxy, não pra uma porta solta no host — a
        // aplicação não publica porta nenhuma, só se expõe na rede interna.
        domain = await this.traefik.createApplicationDomain(serverId, application.id, {
          hostname: dto.domain.hostname,
          serviceName: 'app',
          containerName: container,
          containerPort: port,
          createDnsRecord: dto.domain.createDnsRecord,
        });
      }

      await this.prisma.application.update({ where: { id: application.id }, data: { status: 'RUNNING', lastError: null } });
      await this.prisma.projectService.updateMany({ where: { applicationId: application.id }, data: { status: 'RUNNING' } });

      log?.('Aplicação implantada com sucesso.\n');
      return { ok: true, applicationId: application.id, domain };
    } catch (err) {
      const message = redactToken(err instanceof Error ? err.message : 'Falha na implantação', token);
      await this.prisma.application.update({
        where: { id: application.id },
        data: { status: 'ERROR', lastError: message.slice(0, 500) },
      });
      await this.prisma.projectService.updateMany({ where: { applicationId: application.id }, data: { status: 'ERROR' } });
      return { ok: false, applicationId: application.id, error: message };
    }
  }

  /** Estado do autodeploy + a URL que o usuário cola na forja. */
  async getAutoDeploy(applicationId: string) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Aplicação não encontrada');
    if (app.sourceType !== 'git') throw new BadRequestException('Esta aplicação não veio de um repositório');

    // A base vem do WEB_ORIGIN porque é o endereço por onde a forja alcança o
    // painel — o container não sabe sozinho como é visto de fora.
    const base = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
    return {
      enabled: app.autoDeploy,
      gitRef: app.gitRef,
      webhookUrl: app.webhookSecret ? `${base}/api/webhooks/git/${app.webhookSecret}` : null,
    };
  }

  async setAutoDeploy(applicationId: string, enabled: boolean) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Aplicação não encontrada');
    if (app.sourceType !== 'git') throw new BadRequestException('Esta aplicação não veio de um repositório');

    // Aplicações criadas antes deste recurso não têm segredo — gerar aqui evita
    // obrigar a reimplantar só pra ligar o autodeploy.
    const webhookSecret = app.webhookSecret ?? randomBytes(24).toString('base64url');
    await this.prisma.application.update({ where: { id: app.id }, data: { autoDeploy: enabled, webhookSecret } });
    return this.getAutoDeploy(applicationId);
  }

  /**
   * Reconstrói a partir do mesmo repositório e ref. É o substituto do webhook,
   * que ainda não existe: quem decide quando puxar código novo é o usuário.
   */
  async redeploy(applicationId: string, onLog?: LogFn) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Aplicação não encontrada');
    if (app.sourceType !== 'git' || !app.repoUrl) {
      throw new BadRequestException('Esta aplicação não veio de um repositório');
    }

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const repoDir = `${dir}/repo`;
    const image = `velix/${app.slug}:latest`;
    const container = `${app.slug}_app`;
    const token = app.gitAccountId
      ? await this.gitAccounts.resolveToken(app.gitAccountId)
      : app.repoTokenEnc
        ? decryptCredential(app.repoTokenEnc)
        : undefined;
    const log: LogFn | undefined = onLog && ((line: string) => onLog(redactToken(line, token)));

    await this.prisma.application.update({ where: { id: app.id }, data: { status: 'DEPLOYING' } });

    try {
      const ref = app.gitRef ?? 'main';
      log?.(`Buscando a versão mais recente de ${ref}...\n`);
      // Reset em vez de pull: o diretório é uma cópia descartável do repositório,
      // não um espaço de trabalho — mesma lógica já usada no autoatualizador.
      const fetch = await this.ssh.runCommand(
        options,
        `cd ${repoDir} && sudo git fetch --depth 1 origin '${ref}' && sudo git reset --hard FETCH_HEAD`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!fetch.ok) throw new Error('Falha ao atualizar o repositório no servidor.');

      log?.('Reconstruindo a imagem...\n');
      const buildCmd =
        app.buildMethod === 'nixpacks'
          ? `cd ${repoDir} && sudo nixpacks build . --name ${image}`
          : `cd ${repoDir} && sudo docker build -f ${app.dockerfilePath ?? 'Dockerfile'} -t ${image} .`;
      const build = await this.ssh.runCommand(options, buildCmd, 1_800_000, log && ((chunk) => log(chunk)));
      if (!build.ok) throw new Error('Falha ao reconstruir a imagem.');

      log?.('Recriando o container...\n');
      const up = await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${app.slug} up -d --force-recreate`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!up.ok) throw new Error('Falha ao recriar o container.');

      const running = await this.waitForContainer(options, container, log);
      if (!running) throw new Error('O container não ficou de pé a tempo.');

      await this.prisma.application.update({ where: { id: app.id }, data: { status: 'RUNNING', lastError: null } });
      log?.('Reimplantado com sucesso.\n');
      return { ok: true, applicationId: app.id };
    } catch (err) {
      const message = redactToken(err instanceof Error ? err.message : 'Falha ao reimplantar', token);
      await this.prisma.application.update({
        where: { id: app.id },
        data: { status: 'ERROR', lastError: message.slice(0, 500) },
      });
      return { ok: false, applicationId: app.id, error: message };
    }
  }
}
