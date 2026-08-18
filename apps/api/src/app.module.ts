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
import { DatabaseConsoleModule } from './database-console/database-console.module';
import { UpdateModule } from './updates/update.module';
import { GitAccountsModule } from './git-accounts/git-accounts.module';
import { BackupModule } from './backup/backup.module';
import { AlertsModule } from './alerts/alerts.module';
import { UsersModule } from './users/users.module';
import { ScheduleModule } from '@nestjs/schedule';
import { PushModule } from './push/push.module';
import { AlertThresholdsModule } from './alert-thresholds/alert-thresholds.module';
import { MonitoringModule } from './monitoring/monitoring.module';

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
    // DatabaseBackupModule ANTES de DatabaseModule: os controllers registram
    // rotas na ordem dos módulos aqui, e `DatabaseController` (DatabaseModule)
    // tem uma rota `GET databases/:id` (instância legada, não os bancos por
    // projeto) que — se registrada primeiro — engole `GET databases/backup-
    // routines` do DatabaseBackupController tratando "backup-routines" como
    // se fosse o :id. Foi exatamente esse o bug: a tela de Configurações →
    // Backup caía num "Instância de banco não encontrada" vindo do
    // DatabaseController errado. DatabaseConsoleModule não tem esse risco
    // (todas as rotas dela têm um segmento depois do :id, ex. `:id/schemas`).
    DatabaseBackupModule,
    DatabaseModule,
    TraefikModule,
    CatalogModule,
    ApplicationsModule,
    DatabaseConsoleModule,
    UpdateModule,
    GitAccountsModule,
    BackupModule,
    AlertsModule,
    PushModule,
    AlertThresholdsModule,
    MonitoringModule,
    UsersModule,
  ],
})
export class AppModule {}
