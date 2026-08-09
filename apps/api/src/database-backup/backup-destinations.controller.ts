import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { BackupDestinationsService } from './backup-destinations.service';
import { CreateBackupDestinationDto } from './dto/create-backup-destination.dto';

@Controller('backup-destinations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupDestinationsController {
  constructor(private readonly destinations: BackupDestinationsService) {}

  @Get()
  list() {
    return this.destinations.list();
  }

  @Post()
  @MinRole('operator')
  create(@Body() dto: CreateBackupDestinationDto) {
    return this.destinations.create(dto);
  }

  @Delete(':id')
  @MinRole('operator')
  remove(@Param('id') id: string) {
    return this.destinations.remove(id);
  }
}
