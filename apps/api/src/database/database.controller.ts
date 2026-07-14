import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { DatabaseService } from './database.service';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { CreateReplicaDto } from './dto/create-replica.dto';
import { PromoteReplicaDto } from './dto/promote-replica.dto';
import { BulkReplicateDto } from './dto/bulk-replicate.dto';

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

  @Get('databases/eligible-primaries')
  eligiblePrimaries(@Query('excludeServerId') excludeServerId?: string) {
    return this.db.listEligiblePrimaries(excludeServerId);
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

  @Post('databases/:id/start')
  start(@Param('id') id: string) {
    return this.db.start(id);
  }

  @Post('databases/:id/stop')
  stop(@Param('id') id: string) {
    return this.db.stop(id);
  }

  @Post('databases/:id/replicate')
  createReplica(@Param('id') id: string, @Body() dto: CreateReplicaDto) {
    return this.db.createReplica(id, dto);
  }

  @Post('databases/replicate-bulk')
  replicateBulk(@Body() dto: BulkReplicateDto) {
    return this.db.replicateBulk(dto.primaryInstanceIds, dto.targetServerId);
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
