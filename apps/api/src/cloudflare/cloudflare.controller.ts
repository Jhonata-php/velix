import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CloudflareService } from './cloudflare.service';
import { ConnectAccountDto } from './dto/connect-account.dto';
import { CreateDnsRecordDto, UpdateDnsRecordDto } from './dto/dns-record.dto';

@Controller('cloudflare')
@UseGuards(JwtAuthGuard)
export class CloudflareController {
  constructor(private readonly cloudflare: CloudflareService) {}

  @Get('account')
  getAccount() {
    return this.cloudflare.getAccountStatus();
  }

  @Post('account')
  connect(@Body() dto: ConnectAccountDto) {
    return this.cloudflare.connect(dto.apiToken);
  }

  @Delete('account')
  disconnect() {
    return this.cloudflare.disconnect();
  }

  @Get('zones')
  listZones() {
    return this.cloudflare.listZones();
  }

  @Get('zones/:zoneId/records')
  listRecords(@Param('zoneId') zoneId: string) {
    return this.cloudflare.listRecords(zoneId);
  }

  @Post('zones/:zoneId/records')
  createRecord(@Param('zoneId') zoneId: string, @Body() dto: CreateDnsRecordDto) {
    return this.cloudflare.createRecord(zoneId, dto);
  }

  @Patch('zones/:zoneId/records/:recordId')
  updateRecord(@Param('zoneId') zoneId: string, @Param('recordId') recordId: string, @Body() dto: UpdateDnsRecordDto) {
    return this.cloudflare.updateRecord(zoneId, recordId, dto);
  }

  @Delete('zones/:zoneId/records/:recordId')
  deleteRecord(@Param('zoneId') zoneId: string, @Param('recordId') recordId: string) {
    return this.cloudflare.deleteRecord(zoneId, recordId);
  }

  @Get('lookup')
  lookup(@Query('ip') ip: string) {
    return this.cloudflare.lookupByIp(ip);
  }
}
