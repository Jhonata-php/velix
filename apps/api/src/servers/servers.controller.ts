import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { UpdateServerDto } from './dto/update-server.dto';
import { InstallUpdatesDto } from './dto/install-updates.dto';
import { InstallEasyPanelDto } from './dto/install-easypanel.dto';
import { SetMirrorDto } from './dto/set-mirror.dto';

@Controller('servers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post()
  @MinRole('operator')
  create(@Body() dto: CreateServerDto) {
    return this.servers.create(dto);
  }

  @Post('generate-ssh-key')
  @MinRole('operator')
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
  @MinRole('operator')
  update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.servers.update(id, dto);
  }

  @Delete(':id')
  @MinRole('admin')
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

  @Get(':id/metrics/history')
  metricsHistory(@Param('id') id: string, @Query('hours') hours?: string) {
    const parsed = Number(hours);
    return this.servers.metricsHistory(id, Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
  }

  @Get(':id/mirror')
  getMirror(@Param('id') id: string) {
    return this.servers.getMirror(id);
  }

  @Post(':id/mirror')
  @MinRole('operator')
  setMirror(@Param('id') id: string, @Body() dto: SetMirrorDto) {
    return this.servers.setMirror(id, dto.targetServerId);
  }

  @Delete(':id/mirror')
  @MinRole('operator')
  clearMirror(@Param('id') id: string) {
    return this.servers.clearMirror(id);
  }

  @Post(':id/reboot')
  @MinRole('operator')
  reboot(@Param('id') id: string) {
    return this.servers.reboot(id);
  }

  @Get(':id/updates')
  checkUpdates(@Param('id') id: string) {
    return this.servers.checkUpdates(id);
  }

  @Post(':id/updates/install')
  @MinRole('operator')
  installUpdates(@Param('id') id: string, @Body() dto: InstallUpdatesDto) {
    return this.servers.installUpdates(id, dto.securityOnly ?? false);
  }

  @Post(':id/docker/install')
  @MinRole('operator')
  installDocker(@Param('id') id: string) {
    return this.servers.installDocker(id);
  }

  @Get(':id/docker/status')
  dockerStatus(@Param('id') id: string) {
    return this.servers.dockerStatus(id);
  }

  @Get(':id/docker/containers/:containerId/logs')
  containerLogs(@Param('id') id: string, @Param('containerId') containerId: string, @Query('tail') tail?: string) {
    const parsed = Number(tail);
    return this.servers.containerLogs(id, containerId, Number.isFinite(parsed) && parsed > 0 ? parsed : 200);
  }

  @Get(':id/system-logs')
  systemLogs(@Param('id') id: string, @Query('source') source: string, @Query('tail') tail?: string) {
    const parsed = Number(tail);
    return this.servers.systemLogs(id, source === 'auth' ? 'auth' : 'syslog', Number.isFinite(parsed) && parsed > 0 ? parsed : 200);
  }

  @Post(':id/docker/containers/:containerId/clone')
  @MinRole('operator')
  cloneContainer(@Param('id') id: string, @Param('containerId') containerId: string, @Body('targetServerId') targetServerId: string) {
    return this.servers.cloneContainer(id, containerId, targetServerId);
  }

  @Post(':id/docker/containers/:containerId/start')
  @MinRole('operator')
  startContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.startContainer(id, containerId);
  }

  @Post(':id/docker/containers/:containerId/stop')
  @MinRole('operator')
  stopContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.stopContainer(id, containerId);
  }

  @Delete(':id/docker/containers/:containerId')
  @MinRole('operator')
  removeContainer(@Param('id') id: string, @Param('containerId') containerId: string) {
    return this.servers.removeContainer(id, containerId);
  }

  @Post(':id/easypanel/install')
  @MinRole('operator')
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
