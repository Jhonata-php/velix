import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BackupService } from './backup.service';

@Controller('backups')
@UseGuards(JwtAuthGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  list() {
    return this.backups.list();
  }

  @Post('run')
  run() {
    return this.backups.run('manual');
  }
}
