import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SshService, SshConnectOptions } from '../ssh/ssh.service';
import { ServersService } from '../servers/servers.service';
import { TraefikService } from '../traefik/traefik.service';
import { GitAccountsService } from '../git-accounts/git-accounts.service';
import { randomBytes } from 'crypto';
import { encryptCredential, decryptCredential } from '../ssh/crypto.util';
import { PROXY_NETWORK } from '../traefik/traefik.util';
import { appDir, allContainersUp, uniqueServiceName, mergeComposeFragments } from './applications.util';
import {
  validateRepoUrl,
  validateGitRef,
  validateDockerfilePath,
  cloneUrlWithToken,
  redactToken,
  renderGitCompose,
  validateEnvKey,
  parseGitComposeMeta,
  type BuildMethod,
} from './git-source.util';

type LogFn = (line: string) => void;

const HOSTNAME_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export interface DeployFromGitInput {
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
 * Implantação a partir do código do usuário, em vez de um manifesto curado,
 * dentro de um projeto já existente.
 *
 * A diferença mora só no começo: em vez de puxar uma imagem de registro, o
 * servidor clona o repositório e constrói a imagem ali mesmo. Do compose em
 * diante o caminho é o mesmo do catálogo — inclusive Traefik, domínio e o
 * merge com as outras implantações do projeto (`mergeComposeFragments`).
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

  private async getApplication(applicationId: string) {
    const app = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Projeto não encontrado');
    return app;
  }

  private async mergedComposeExcluding(applicationId: string, excludeDeploymentId?: string) {
    const deployments = await this.prisma.projectDeployment.findMany({
      where: { applicationId, ...(excludeDeploymentId ? { id: { not: excludeDeploymentId } } : {}) },
    });
    return mergeComposeFragments(deployments.map((d) => d.composeRendered));
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

  /** Melhor esforço: se o log de commit falhar por qualquer motivo, o deploy segue sem essa informação. */
  private async getCommitInfo(options: SshConnectOptions, repoDir: string): Promise<{ sha?: string; message?: string }> {
    const result = await this.ssh.runCommand(options, `cd ${repoDir} && git log -1 --pretty=format:%H%n%s`, 15_000);
    if (!result.ok || !result.stdout.trim()) return {};
    const [sha, ...rest] = result.stdout.split('\n');
    return { sha: sha?.trim() || undefined, message: rest.join('\n').trim() || undefined };
  }

  /** Cria a linha de histórico "em andamento" — atualizada por {@link finishDeploymentRun} quando o deploy termina. */
  async startDeploymentRun(
    applicationId: string,
    opts: { deploymentId?: string; trigger: 'manual' | 'webhook'; triggeredByUserId?: string },
  ) {
    return this.prisma.projectDeploymentRun.create({
      data: {
        applicationId,
        deploymentId: opts.deploymentId ?? null,
        trigger: opts.trigger,
        triggeredByUserId: opts.triggeredByUserId ?? null,
      },
    });
  }

  async finishDeploymentRun(
    runId: string,
    result: { ok: boolean; error?: string; commitSha?: string; commitMessage?: string; log?: string },
  ) {
    await this.prisma.projectDeploymentRun.update({
      where: { id: runId },
      data: {
        status: result.ok ? 'SUCCESS' : 'ERROR',
        error: result.error ?? null,
        commitSha: result.commitSha ?? null,
        commitMessage: result.commitMessage ?? null,
        log: result.log ?? null,
        finishedAt: new Date(),
      },
    });
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

  async deploy(
    applicationId: string,
    dto: DeployFromGitInput,
    onLog?: LogFn,
    meta?: { trigger?: 'manual' | 'webhook'; triggeredByUserId?: string },
  ) {
    const app = await this.getApplication(applicationId);
    const { server, options } = await this.servers.getServerWithConnectOptions(app.serverId);
    if (!server.dockerInstalled) {
      throw new BadRequestException('Instale o Docker neste servidor antes de implantar serviços');
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
      throw new BadRequestException('Informe a porta que o serviço escuta dentro do container');
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

    const slug = app.slug;
    const dir = appDir(slug);
    const repoDir = `${dir}/repo`;
    const existingNames = (await this.prisma.projectService.findMany({ where: { applicationId }, select: { name: true } })).map(
      (s) => s.name,
    );
    const repoBase = repo.url.replace(/\.git$/, '').split('/').filter(Boolean).pop() || 'app';
    const serviceName = uniqueServiceName(repoBase, existingNames);
    const image = `velix/${slug}-${serviceName}:latest`;
    const container = `${slug}_${serviceName}`;
    const volumes = dto.volumes ?? [];
    const env = dto.env ?? {};

    const deploymentCompose = renderGitCompose({ slug, serviceName, image, port, env, volumes, proxyNetwork: PROXY_NETWORK });

    // Toda linha de log passa por aqui: o token vai embutido na URL de clone e
    // o git costuma ecoá-la em mensagens de erro. Também acumulada em
    // logBuffer pra virar o log gravado no histórico de implantação.
    const logBuffer: string[] = [];
    const log: LogFn = (line: string) => {
      const clean = redactToken(line, token);
      logBuffer.push(clean);
      onLog?.(clean);
    };

    const deployment = await this.prisma.projectDeployment.create({
      data: {
        applicationId,
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
        composeRendered: deploymentCompose,
        variablesJson: Object.keys(env).length > 0 ? JSON.stringify(env) : null,
        services: {
          create: [{ applicationId, name: serviceName, image, containerName: container, required: true, status: 'DEPLOYING' }],
        },
      },
    });

    const mergedCompose = await this.mergedComposeExcluding(applicationId);
    await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'DEPLOYING', composeRendered: mergedCompose } });

    const run = await this.startDeploymentRun(applicationId, {
      deploymentId: deployment.id,
      trigger: meta?.trigger ?? 'manual',
      triggeredByUserId: meta?.triggeredByUserId,
    });
    let commitSha: string | undefined;
    let commitMessage: string | undefined;

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

      const commit = await this.getCommitInfo(options, repoDir);
      commitSha = commit.sha;
      commitMessage = commit.message;

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
      const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
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
      if (!running) throw new Error('O container não ficou de pé a tempo — confira o log do serviço.');

      let domain = null;
      if (dto.domain) {
        log?.(`Associando domínio ${dto.domain.hostname}...\n`);
        // createApplicationDomain (e não createDomain): a rota aponta pro nome
        // do container na rede do proxy, não pra uma porta solta no host — o
        // serviço não publica porta nenhuma, só se expõe na rede interna.
        domain = await this.traefik.createApplicationDomain(app.serverId, applicationId, {
          hostname: dto.domain.hostname,
          serviceName,
          containerName: container,
          containerPort: port,
          createDnsRecord: dto.domain.createDnsRecord,
        });
      }

      await this.prisma.application.update({
        where: { id: applicationId },
        data: { status: 'RUNNING', containerNames: [...app.containerNames, container], lastError: null },
      });
      await this.prisma.projectService.updateMany({ where: { deploymentId: deployment.id }, data: { status: 'RUNNING' } });

      log?.('Serviço implantado com sucesso.\n');
      await this.finishDeploymentRun(run.id, { ok: true, commitSha, commitMessage, log: logBuffer.join('') });
      return { ok: true, applicationId, deploymentId: deployment.id, domain, commitSha, commitMessage };
    } catch (err) {
      const message = redactToken(err instanceof Error ? err.message : 'Falha na implantação', token);
      await this.prisma.application.update({ where: { id: applicationId }, data: { status: 'ERROR', lastError: message.slice(0, 500) } });
      await this.prisma.projectService.updateMany({ where: { deploymentId: deployment.id }, data: { status: 'ERROR' } });
      await this.finishDeploymentRun(run.id, { ok: false, error: message, commitSha, commitMessage, log: logBuffer.join('') });
      return { ok: false, applicationId, deploymentId: deployment.id, error: message, commitSha, commitMessage };
    }
  }

  /** Estado do autodeploy + a URL que o usuário cola na forja. */
  async getAutoDeploy(deploymentId: string) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (deployment.sourceType !== 'git') throw new BadRequestException('Este serviço não veio de um repositório');

    // A base vem do WEB_ORIGIN porque é o endereço por onde a forja alcança o
    // painel — o container não sabe sozinho como é visto de fora.
    const base = (process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
    return {
      enabled: deployment.autoDeploy,
      gitRef: deployment.gitRef,
      webhookUrl: deployment.webhookSecret ? `${base}/api/webhooks/git/${deployment.webhookSecret}` : null,
    };
  }

  async setAutoDeploy(deploymentId: string, enabled: boolean) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (deployment.sourceType !== 'git') throw new BadRequestException('Este serviço não veio de um repositório');

    // Implantações criadas antes deste recurso não têm segredo — gerar aqui
    // evita obrigar a reimplantar só pra ligar o autodeploy.
    const webhookSecret = deployment.webhookSecret ?? randomBytes(24).toString('base64url');
    await this.prisma.projectDeployment.update({ where: { id: deployment.id }, data: { autoDeploy: enabled, webhookSecret } });
    return this.getAutoDeploy(deploymentId);
  }

  /**
   * Troca as variáveis de ambiente de um serviço vindo de repositório. Não
   * reconstrói a imagem (nada do código mudou) — só reescreve o compose com o
   * `environment:` novo e recria o container, uma chamada síncrona rápida
   * (mesmo padrão de `ApplicationsService.setPublishedPort`, sem passar pelo
   * canal /ops). Porta e volumes são extraídos de volta do compose já salvo
   * (`parseGitComposeMeta`), porque hoje só existem ali, não em coluna própria.
   */
  async updateEnv(deploymentId: string, env: Record<string, string>) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (deployment.sourceType !== 'git') {
      throw new BadRequestException('Este serviço não veio de um repositório');
    }
    const app = await this.getApplication(deployment.applicationId);
    const service = await this.prisma.projectService.findFirst({ where: { deploymentId } });
    if (!service) throw new NotFoundException('Container deste serviço não encontrado');

    for (const key of Object.keys(env)) {
      if (!validateEnvKey(key)) throw new BadRequestException(`Nome de variável inválido: "${key}"`);
    }

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const { port, volumes } = parseGitComposeMeta(deployment.composeRendered, app.slug);

    const deploymentCompose = renderGitCompose({
      slug: app.slug,
      serviceName: service.name,
      image: service.image,
      port,
      env,
      volumes,
      proxyNetwork: PROXY_NETWORK,
    });

    await this.prisma.projectDeployment.update({
      where: { id: deploymentId },
      data: { composeRendered: deploymentCompose, variablesJson: Object.keys(env).length > 0 ? JSON.stringify(env) : null },
    });

    const mergedCompose = await this.mergedComposeExcluding(app.id);

    const write = await this.ssh.writeRemoteFile(options, `${dir}/docker-compose.yml`, mergedCompose, '644');
    if (!write.ok) throw new BadRequestException(write.message);

    const up = await this.ssh.runCommand(options, `cd ${dir} && sudo docker compose -p ${app.slug} up -d --force-recreate ${service.name}`, 120_000);
    if (!up.ok) throw new BadRequestException(up.stdout + up.stderr || 'Falha ao recriar o container');

    await this.prisma.application.update({ where: { id: app.id }, data: { composeRendered: mergedCompose } });

    return { ok: true, env };
  }

  /**
   * Reconstrói a partir do mesmo repositório e ref. É o substituto do webhook
   * quando o usuário decide quando puxar código novo, e é também o que o
   * webhook chama quando chega um push.
   */

  async redeploy(
    deploymentId: string,
    onLog?: LogFn,
    meta?: { trigger?: 'manual' | 'webhook'; triggeredByUserId?: string },
  ) {
    const deployment = await this.prisma.projectDeployment.findUnique({ where: { id: deploymentId } });
    if (!deployment) throw new NotFoundException('Implantação não encontrada');
    if (deployment.sourceType !== 'git' || !deployment.repoUrl) {
      throw new BadRequestException('Este serviço não veio de um repositório');
    }
    const app = await this.getApplication(deployment.applicationId);
    const service = await this.prisma.projectService.findFirst({ where: { deploymentId } });
    if (!service) throw new NotFoundException('Container deste serviço não encontrado');

    const { options } = await this.servers.getServerWithConnectOptions(app.serverId);
    const dir = appDir(app.slug);
    const repoDir = `${dir}/repo`;
    const image = service.image;
    const container = service.containerName;
    const token = deployment.gitAccountId
      ? await this.gitAccounts.resolveToken(deployment.gitAccountId)
      : deployment.repoTokenEnc
        ? decryptCredential(deployment.repoTokenEnc)
        : undefined;
    const logBuffer: string[] = [];
    const log: LogFn = (line: string) => {
      const clean = redactToken(line, token);
      logBuffer.push(clean);
      onLog?.(clean);
    };

    await this.prisma.application.update({ where: { id: app.id }, data: { status: 'DEPLOYING' } });

    const run = await this.startDeploymentRun(app.id, {
      deploymentId: deployment.id,
      trigger: meta?.trigger ?? 'manual',
      triggeredByUserId: meta?.triggeredByUserId,
    });
    let commitSha: string | undefined;
    let commitMessage: string | undefined;

    try {
      const ref = deployment.gitRef ?? 'main';
      log?.(`Buscando a versão mais recente de ${ref}...\n`);
      // O remote "origin" ficou com o token de acesso EMBUTIDO na URL desde o
      // clone original (cloneUrlWithToken) — um token de instalação do GitHub
      // App expira em ~1h, então qualquer redeploy depois disso falhava com
      // "Invalid username or token" mesmo com o GitHub ainda configurado
      // certinho: a URL salva no .git/config é que estava velha. `token` já
      // foi resolvido de novo (fresco) no topo desta função — só faltava
      // aplicar ele na URL antes de buscar. Reset em vez de pull: o diretório
      // é uma cópia descartável do repositório, não um espaço de trabalho —
      // mesma lógica já usada no autoatualizador.
      const freshUrl = cloneUrlWithToken(deployment.repoUrl, token);
      const fetch = await this.ssh.runCommand(
        options,
        `cd ${repoDir} && sudo git remote set-url origin '${freshUrl}' && sudo git fetch --depth 1 origin '${ref}' && sudo git reset --hard FETCH_HEAD`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!fetch.ok) throw new Error(`Falha ao atualizar o repositório no servidor: ${fetch.stderr || fetch.message}`);

      const commit = await this.getCommitInfo(options, repoDir);
      commitSha = commit.sha;
      commitMessage = commit.message;

      log?.('Reconstruindo a imagem...\n');
      const buildCmd =
        deployment.buildMethod === 'nixpacks'
          ? `cd ${repoDir} && sudo nixpacks build . --name ${image}`
          : `cd ${repoDir} && sudo docker build -f ${deployment.dockerfilePath ?? 'Dockerfile'} -t ${image} .`;
      const build = await this.ssh.runCommand(options, buildCmd, 1_800_000, log && ((chunk) => log(chunk)));
      if (!build.ok) throw new Error('Falha ao reconstruir a imagem — veja o log do build acima.');

      log?.('Recriando o container...\n');
      const up = await this.ssh.runCommand(
        options,
        `cd ${dir} && sudo docker compose -p ${app.slug} up -d --force-recreate ${service.name}`,
        600_000,
        log && ((chunk) => log(chunk)),
      );
      if (!up.ok) throw new Error(up.stdout + up.stderr || 'Falha ao recriar o container');

      const running = await this.waitForContainer(options, container, log);
      if (!running) throw new Error('O container não ficou de pé a tempo — confira o log do serviço.');

      await this.prisma.application.update({ where: { id: app.id }, data: { status: 'RUNNING', lastError: null } });
      log?.('Reimplantado com sucesso.\n');
      await this.finishDeploymentRun(run.id, { ok: true, commitSha, commitMessage, log: logBuffer.join('') });
      return { ok: true, applicationId: app.id, commitSha, commitMessage };
    } catch (err) {
      const message = redactToken(err instanceof Error ? err.message : 'Falha ao reimplantar', token);
      await this.prisma.application.update({ where: { id: app.id }, data: { status: 'ERROR', lastError: message.slice(0, 500) } });
      await this.finishDeploymentRun(run.id, { ok: false, error: message, commitSha, commitMessage, log: logBuffer.join('') });
      return { ok: false, applicationId: app.id, error: message, commitSha, commitMessage };
    }
  }
}
