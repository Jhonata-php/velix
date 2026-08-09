import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { DatabaseBackupService } from './database-backup.service';
import { SetBackupConfigDto } from './dto/set-backup-config.dto';

/** Disparo de backup manual é via canal /ops (op "database-backup-run"),
 * não aqui — um dump pode demorar em banco grande, mesmo motivo de
 * "service-db-import" já ser streamado em vez de uma chamada REST síncrona. */
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseBackupController {
  constructor(private readonly databaseBackup: DatabaseBackupService) {}

  @Get()
  list() {
    return this.databaseBackup.listDatabases();
  }

  @Get(':id/backup-config')
  getConfig(@Param('id') id: string) {
    return this.databaseBackup.getConfig(id);
  }

  @Patch(':id/backup-config')
  @MinRole('operator')
  setConfig(@Param('id') id: string, @Body() dto: SetBackupConfigDto) {
    return this.databaseBackup.setConfig(id, dto);
  }

  @Get(':id/backup-runs')
  listRuns(@Param('id') id: string) {
    return this.databaseBackup.listRuns(id);
  }
}
