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
import { DatabaseBackupModule } from './database-backup/database-backup.module';
import { UpdateModule } from './updates/update.module';
import { GitAccountsModule } from './git-accounts/git-accounts.module';
import { BackupModule } from './backup/backup.module';
import { AlertsModule } from './alerts/alerts.module';
import { UsersModule } from './users/users.module';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // Sem isto o @Cron do backup nunca dispara — e a falha é silenciosa:
    // nada quebra, o backup só não acontece.
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    AuthModule,
    ServersModule,
    CloudflareModule,
    DatabaseModule,
    TraefikModule,
    CatalogModule,
    ApplicationsModule,
    DatabaseBackupModule,
    UpdateModule,
    GitAccountsModule,
    BackupModule,
    AlertsModule,
    UsersModule,
  ],
})
export class AppModule {}
