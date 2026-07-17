import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { CloudflareModule } from './cloudflare/cloudflare.module';
import { DatabaseModule } from './database/database.module';
import { TraefikModule } from './traefik/traefik.module';
import { CatalogModule } from './catalog/catalog.module';
import { ApplicationsModule } from './applications/applications.module';

@Module({
  imports: [PrismaModule, AuthModule, ServersModule, CloudflareModule, DatabaseModule, TraefikModule, CatalogModule, ApplicationsModule],
})
export class AppModule {}
