import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DatabaseService } from './database.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { CreateReplicaDto } from './dto/create-replica.dto';
import { PromoteReplicaDto } from './dto/promote-replica.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class DatabaseController {
  constructor(private readonly db: DatabaseService) {}

  @Post('servers/:serverId/databases')
  install(@Param('serverId') serverId: string, @Body() dto: CreateInstanceDto) {
    return this.db.installInstance(serverId, dto);
  }

  @Get('servers/:serverId/databases')
  list(@Param('serverId') serverId: string) {
    return this.db.listInstances(serverId);
  }

  @Get('databases/:id')
  findOne(@Param('id') id: string) {
    return this.db.findOne(id);
  }

  @Delete('databases/:id')
  remove(@Param('id') id: string) {
    return this.db.remove(id);
  }

  @Get('databases/:id/status')
  status(@Param('id') id: string) {
    return this.db.status(id);
  }

  @Post('databases/:id/replicate')
  createReplica(@Param('id') id: string, @Body() dto: CreateReplicaDto) {
    return this.db.createReplica(id, dto);
  }

  @Get('replications/:id')
  replicationStatus(@Param('id') id: string) {
    return this.db.replicationStatus(id);
  }

  @Post('replications/:id/promote')
  promote(@Param('id') id: string, @Body() dto: PromoteReplicaDto) {
    void dto;
    return this.db.promoteReplica(id);
  }
}
