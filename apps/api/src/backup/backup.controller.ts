import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupService } from './backup.service';

@Controller('backups')
@UseGuards(JwtAuthGuard, RolesGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Post('run')
  @MinRole('admin')
  run() {
    return this.backups.run('manual');
  }
}
