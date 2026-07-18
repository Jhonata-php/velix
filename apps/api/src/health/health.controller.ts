import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VersionService } from '../version/version.service';

/**
 * Endpoint de infraestrutura — checado pelo Docker HEALTHCHECK, por proxies
 * reversos e pelo instalador (`velix doctor`). Faz uma consulta real no
 * banco: um processo "vivo" mas sem banco não deve contar como saudável.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly version: VersionService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async check() {
    const info = this.version.getInfo();
    let database: { status: 'connected' | 'unreachable'; error?: string };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { status: 'connected' };
    } catch (err) {
      database = { status: 'unreachable', error: err instanceof Error ? err.message : String(err) };
    }

    const body = {
      status: database.status === 'connected' ? ('ok' as const) : ('degraded' as const),
      application: 'velix-api',
      version: info.version,
      commit: info.commit,
      buildDate: info.buildDate,
      nodeVersion: info.nodeVersion,
      uptimeSeconds: info.uptimeSeconds,
      database,
    };

    if (database.status !== 'connected') {
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
