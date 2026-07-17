import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TraefikService } from './traefik.service';
import { CreateDomainDto } from './dto/create-domain.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class TraefikController {
  constructor(private readonly traefik: TraefikService) {}

  @Get('servers/:id/traefik/status')
  status(@Param('id') id: string) {
    return this.traefik.traefikStatus(id);
  }

  @Post('servers/:id/traefik/uninstall')
  uninstall(@Param('id') id: string) {
    return this.traefik.uninstallTraefik(id);
  }

  @Get('servers/:id/domains')
  listDomains(@Param('id') id: string) {
    return this.traefik.listDomains(id);
  }

  @Post('servers/:id/domains')
  createDomain(@Param('id') id: string, @Body() dto: CreateDomainDto) {
    return this.traefik.createDomain(id, dto);
  }

  @Get('domains/:domainId/verify')
  verifyDomain(@Param('domainId') domainId: string) {
    return this.traefik.verifyDomain(domainId);
  }

  @Get('domains/:domainId/dns')
  checkDns(@Param('domainId') domainId: string) {
    return this.traefik.checkDomainDns(domainId);
  }

  @Get('domains/:domainId/certificate')
  checkCertificate(@Param('domainId') domainId: string) {
    return this.traefik.checkDomainCertificate(domainId);
  }

  @Delete('domains/:domainId')
  deleteDomain(@Param('domainId') domainId: string) {
    return this.traefik.deleteDomain(domainId);
  }
}
