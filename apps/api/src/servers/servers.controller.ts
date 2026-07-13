import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ServersService } from './servers.service';
import { CreateServerDto } from './dto/create-server.dto';

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
}
