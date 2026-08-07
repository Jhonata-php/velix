import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { DatabaseModule } from './database/database.module';
import { TraefikModule } from './traefik/traefik.module';
import { CatalogModule } from './catalog/catalog.module';
import { ApplicationsModule } from './applications/applications.module';
import { UpdateModule } from './updates/update.module';
import { GitAccountsModule } from './git-accounts/git-accounts.module';

@Module({
  imports: [
    PrismaModule,
    HealthModule,
    AuthModule,
    ServersModule,
    CloudflareModule,
    DatabaseModule,
    TraefikModule,
    CatalogModule,
    ApplicationsModule,
    UpdateModule,
    GitAccountsModule,
  ],
})
export class AppModule {}
