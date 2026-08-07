import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AlertsService, CreateChannelInput } from './alerts.service';

@Controller('alerts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get('channels')
  list() {
    return this.alerts.listChannels();
  }

  @Post('channels')
  @MinRole('admin')
  create(@Body() dto: CreateChannelInput) {
    return this.alerts.createChannel(dto);
  }

  @Post('channels/:id/test')
  @MinRole('operator')
  test(@Param('id') id: string) {
    return this.alerts.testChannel(id);
  }

  @Delete('channels/:id')
  @MinRole('admin')
  remove(@Param('id') id: string) {
    return this.alerts.removeChannel(id);
  }
}
