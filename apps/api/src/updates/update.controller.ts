import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateService } from './update.service';

@Controller('updates')
@UseGuards(JwtAuthGuard)
export class UpdateController {
  constructor(private readonly updates: UpdateService) {}

  @Get('current')
  current() {
    return this.updates.getCurrent();
  }

  @Get('latest')
  latest() {
    return this.updates.check({ force: false });
  }

  @Post('check')
  forceCheck() {
    return this.updates.check({ force: true });
  }

  @Get('history')
  history(@Query('limit') limit?: string) {
    return this.updates.history(limit ? parseInt(limit, 10) : undefined);
  }
}
