import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { AlertThresholdsService } from './alert-thresholds.service';
import { UpdateThresholdDto } from './dto/update-threshold.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller()
@UseGuards(JwtAuthGuard)
export class AlertThresholdsController {
  constructor(private readonly thresholds: AlertThresholdsService) {}

  @Get('alerts/thresholds')
  getGlobal(@Req() req: AuthedRequest) {
    return this.thresholds.getGlobal(req.user.sub);
  }

  @Put('alerts/thresholds')
  updateGlobal(@Body() dto: UpdateThresholdDto, @Req() req: AuthedRequest) {
    return this.thresholds.updateGlobal(req.user.sub, dto);
  }

  @Get('servers/:id/alerts/thresholds')
  getForServer(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.thresholds.getForServer(req.user.sub, id);
  }

  @Put('servers/:id/alerts/thresholds')
  updateForServer(@Param('id') id: string, @Body() dto: UpdateThresholdDto, @Req() req: AuthedRequest) {
    return this.thresholds.updateForServer(req.user.sub, id, dto);
  }
}
