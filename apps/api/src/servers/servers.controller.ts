import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';
import { InstallUpdatesDto } from './dto/install-updates.dto';

@Controller('servers')
@UseGuards(JwtAuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Post()
  create(@Body() dto: CreateServerDto) {
    return this.servers.create(dto);
  }

  @Get()
  findAll() {
    return this.servers.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.servers.findOne(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servers.remove(id);
  }

  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.servers.testConnection(id);
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
}
