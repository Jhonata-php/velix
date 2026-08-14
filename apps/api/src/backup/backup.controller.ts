import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupService } from './backup.service';
import { UpdateBackupSettingsDto } from './dto/update-backup-settings.dto';

@Controller('backups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Patch('config')
  @MinRole('admin')
  updateConfig(@Body() dto: UpdateBackupSettingsDto) {
    return this.backups.updateSettings(dto);
  }

  @Post('run')
  @MinRole('admin')
  run() {
    return this.backups.run('manual');
  }
}
