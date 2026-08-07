import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDomainDto } from './dto/create-application-domain.dto';

// A implantação (`deploy`) é demorada e tem log ao vivo — só existe via o
// canal /ops (op "app-deploy"), mesmo padrão do Traefik. Aqui ficam as ações
// rápidas, sem stream: listar, consultar, start/stop/restart/remover.
@Controller()
@UseGuards(JwtAuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

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

  @Post('applications/:appId/services/:name/start')
  startService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'start');
  }

  @Post('applications/:appId/services/:name/stop')
  stopService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'stop');
  }

  @Post('applications/:appId/services/:name/restart')
  restartService(@Param('appId') appId: string, @Param('name') name: string) {
    return this.applications.serviceAction(appId, name, 'restart');
  }

  @Post('applications/:appId/domains')
  createDomain(@Param('appId') appId: string, @Body() dto: CreateApplicationDomainDto) {
    return this.applications.createDomain(appId, dto);
  }

  @Patch('applications/:appId/domains/:domainId')
  updateDomain(@Param('appId') appId: string, @Param('domainId') domainId: string, @Body() dto: CreateApplicationDomainDto) {
    return this.applications.updateDomain(appId, domainId, dto);
  }

  @Get('applications/:appId/credentials')
  getCredentials(@Param('appId') appId: string) {
    return this.applications.getCredentials(appId);
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
  remove(@Param('appId') appId: string) {
    return this.applications.remove(appId);
  }
}
