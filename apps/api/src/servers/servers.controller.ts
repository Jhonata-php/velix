import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { InstallUpdatesDto } from './dto/install-updates.dto';
import { InstallEasyPanelDto } from './dto/install-easypanel.dto';

@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post()
  create(@Body() dto: CreateServerDto) {
    return this.servers.create(dto);
  }

  @Post('generate-ssh-key')
  generateSshKey() {
    return this.servers.generateSshKey();
  }

  @Get()
  findAll() {
    return this.servers.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.servers.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.servers.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servers.remove(id);
  }

  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.servers.testConnection(id);
  }

  @Get(':id/metrics')
  collectMetrics(@Param('id') id: string) {
    return this.servers.collectMetrics(id);
  }

  @Post(':id/reboot')
  reboot(@Param('id') id: string) {
    return this.servers.reboot(id);
  }

  @Get(':id/updates')
  checkUpdates(@Param('id') id: string) {
    return this.servers.checkUpdates(id);
  }

  @Post(':id/updates/install')
  installUpdates(@Param('id') id: string, @Body() dto: InstallUpdatesDto) {
    return this.servers.installUpdates(id, dto.securityOnly ?? false);
  }

  @Post(':id/docker/install')
  installDocker(@Param('id') id: string) {
    return this.servers.installDocker(id);
  }

  @Get(':id/docker/status')
  dockerStatus(@Param('id') id: string) {
    return this.servers.dockerStatus(id);
  }

  @Post(':id/docker/containers/:containerId/start')
  startContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.startContainer(id, containerId);
  }

  @Post(':id/docker/containers/:containerId/stop')
  stopContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.stopContainer(id, containerId);
  }

  @Delete(':id/docker/containers/:containerId')
  removeContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.removeContainer(id, containerId);
  }

  @Post(':id/easypanel/install')
  installEasyPanel(@Param('id') id: string, @Body() dto: InstallEasyPanelDto) {
    return this.servers.installEasyPanel(id, dto);
  }

  @Get(':id/easypanel/status')
  easypanelStatus(@Param('id') id: string) {
    return this.servers.easypanelStatus(id);
  }

  @Get(':id/easypanel/verify-domain')
  verifyEasyPanelDomain(@Query('domain') domain: string) {
    return this.servers.verifyEasyPanelDomain(domain);
  }

  @Post(':id/easypanel/lock-port')
  lockEasyPanelPort(@Param('id') id: string) {
    return this.servers.lockEasyPanelPort(id);
  }
}
