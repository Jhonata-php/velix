import { Body, Controller, Delete, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { PushService } from './push.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller('push/devices')
@UseGuards(JwtAuthGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post()
  async register(@Body() dto: RegisterDeviceDto, @Req() req: AuthedRequest) {
    await this.push.registerDevice(req.user.sub, dto.platform, dto.fcmToken);
    return { ok: true };
  }

  @Delete(':id')
  async unregister(@Param('id') id: string, @Req() req: AuthedRequest) {
    await this.push.unregisterDevice(req.user.sub, id);
    return { ok: true };
  }
}
