import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationsService } from './applications.service';
import { GitDeployService } from './git-deploy.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateApplicationDomainDto } from './dto/create-application-domain.dto';
import { registerSqlImportUpload } from './sql-import-uploads.util';

const SQL_IMPORT_MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB — dump de banco real pode ser grande

// A implantação de um serviço (`deployManifestIntoProject`/`GitDeployService.
// deploy`) é demorada e tem log ao vivo — só existe via o canal /ops (op
// "service-deploy"/"service-deploy-git"), mesmo padrão do Traefik. Aqui ficam
// as ações rápidas, sem stream: criar projeto vazio, listar, consultar,
// start/stop/restart/remover.
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly gitDeploy: GitDeployService,
  ) {}

  @Post('applications')
  @MinRole('operator')
  createProject(@Body() dto: CreateProjectDto) {
    return this.applications.createProject(dto);
  }

  /**
   * Recebe o .sql via multipart/form-data e grava direto em disco local (sem
   * passar pelo body JSON) — arquivo grande lido inteiro como string no
   * navegador e mandado como um único JSON no WebSocket já derrubou a aba do
   * usuário ("allocation size overflow"). O upload só devolve um `uploadId`;
   * quem importa de verdade é o op "service-db-import" do canal /ops, que
   * manda esse arquivo pro servidor gerenciado via SFTP e roda o import com
   * log ao vivo — igual já fazia antes, só que a partir de um arquivo local
   * em vez de uma string que passou pelo corpo da requisição.
   */
  @Post('applications/:appId/services/:name/db-import/upload')
  @MinRole('operator')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (_req, _file, cb) => cb(null, `velix-sql-import-${randomBytes(6).toString('hex')}.sql`),
      }),
      limits: { fileSize: SQL_IMPORT_MAX_BYTES },
    }),
  )
  uploadSqlImport(@UploadedFile() file: Express.Multer.File) {
    const uploadId = registerSqlImportUpload(file.path);
    return { uploadId };
  }

  @Get('applications')
  listAll() {
    return this.applications.listAll();
  }

  @Get('servers/:id/applications')
  listForServer(@Param('id') id: string) {
    return this.applications.listForServer(id);
  }

  @Get('applications/:appId')
  getOne(@Param('appId') appId: string) {
    return this.applications.getOne(appId);
  }

  @Get('applications/:appId/endpoints')
  discoverEndpoints(@Param('appId') appId: string) {
    return this.applications.discoverEndpoints(appId);
  }

  @Get('applications/:appId/services')
  getServices(@Param('appId') appId: string) {
    return this.applications.getServices(appId);
  }

  @Get('applications/:appId/services/:name/stats')
  getServiceStats(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.getServiceStats(appId, name);
  }

  /** Histórico de implantações — sem o log completo, que é pesado; ver o endpoint de detalhe pra isso. */
  @Get('applications/:appId/deployment-runs')
  listDeploymentRuns(@Param('appId') appId: string) {
    return this.applications.listDeploymentRuns(appId);
  }

  @Get('applications/:appId/deployment-runs/:runId')
  getDeploymentRun(@Param('appId') appId: string, @Param('runId') runId: string) {
    return this.applications.getDeploymentRun(appId, runId);
  }

  @Post('applications/:appId/services/:name/start')
  @MinRole('operator')
  startService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'start');
  }

  @Post('applications/:appId/services/:name/stop')
  @MinRole('operator')
  stopService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'stop');
  }

  @Post('applications/:appId/services/:name/restart')
  @MinRole('operator')
  restartService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'restart');
  }

  /** `port: null` remove a publicação — ver comentário do método no service. */
  @Post('applications/:appId/services/:name/publish-port')
  @MinRole('operator')
  publishPort(@Param('appId') appId: string, @Param('name') name: string, @Body('port') port: number | null) {
    return this.applications.setPublishedPort(appId, name, port);
  }

  /** Remove UMA implantação do projeto (ex.: tirar um serviço avulso), mantendo
   * o resto no ar — diferente do DELETE em `/applications/:appId`, que apaga
   * o projeto inteiro. */
  @Delete('applications/:appId/deployments/:deploymentId')
  @MinRole('operator')
  removeService(@Param('appId') appId: string, @Param('deploymentId') deploymentId: string) {
    return this.applications.removeService(appId, deploymentId);
  }

  @Post('applications/:appId/domains')
  @MinRole('operator')
  createDomain(@Param('appId') appId: string, @Body() dto: CreateApplicationDomainDto) {
    return this.applications.createDomain(appId, dto);
  }

  @Patch('applications/:appId/domains/:domainId')
  updateDomain(@Param('appId') appId: string, @Param('domainId') domainId: string, @Body() dto: CreateApplicationDomainDto) {
    return this.applications.updateDomain(appId, domainId, dto);
  }

  /** Configuração de autodeploy — a URL do webhook só é devolvida aqui, para
   * um usuário autenticado, nunca na listagem geral de projetos. */
  @Get('applications/:appId/deployments/:deploymentId/auto-deploy')
  getAutoDeploy(@Param('deploymentId') deploymentId: string) {
    return this.gitDeploy.getAutoDeploy(deploymentId);
  }

  @Patch('applications/:appId/deployments/:deploymentId/auto-deploy')
  @MinRole('operator')
  setAutoDeploy(@Param('deploymentId') deploymentId: string, @Body('enabled') enabled: boolean) {
    return this.gitDeploy.setAutoDeploy(deploymentId, !!enabled);
  }

  /** Associa uma conta de forja salva a uma implantação já existente — cobre
   * quem implantou de um repositório público sem token e só agora precisa de
   * um (pra criar o webhook automaticamente, ver GitDeployService). */
  @Patch('applications/:appId/deployments/:deploymentId/git-account')
  @MinRole('operator')
  setGitAccount(@Param('deploymentId') deploymentId: string, @Body('gitAccountId') gitAccountId: string) {
    return this.gitDeploy.setGitAccount(deploymentId, gitAccountId);
  }

  @Get('applications/:appId/deployments/:deploymentId/credentials')
  getCredentials(@Param('deploymentId') deploymentId: string) {
    return this.applications.getCredentials(deploymentId);
  }

  /** Host/porta/usuário/banco pra montar a string de conexão — ver comentário no service. */
  @Get('applications/:appId/deployments/:deploymentId/connection-info')
  getConnectionInfo(@Param('deploymentId') deploymentId: string) {
    return this.applications.getConnectionInfo(deploymentId);
  }

  @Get('applications/:appId/deployments/:deploymentId/env')
  getEnv(@Param('deploymentId') deploymentId: string) {
    return this.applications.getEnv(deploymentId);
  }

  @Patch('applications/:appId/deployments/:deploymentId/env')
  @MinRole('operator')
  updateEnv(@Param('deploymentId') deploymentId: string, @Body('env') env: Record<string, string>) {
    return this.gitDeploy.updateEnv(deploymentId, env ?? {});
  }

  @Get('applications/:appId/deployments/:deploymentId/security')
  getSecurityRisks(@Param('deploymentId') deploymentId: string) {
    return this.applications.getSecurityRisks(deploymentId);
  }

  @Post('applications/:appId/start')
  start(@Param('appId') appId: string) {
    return this.applications.start(appId);
  }

  @Post('applications/:appId/stop')
  stop(@Param('appId') appId: string) {
    return this.applications.stop(appId);
  }

  @Post('applications/:appId/restart')
  restart(@Param('appId') appId: string) {
    return this.applications.restart(appId);
  }

  @Delete('applications/:appId')
  @MinRole('operator')
  remove(@Param('appId') appId: string) {
    return this.applications.remove(appId);
  }
}
