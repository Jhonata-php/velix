import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { DatabaseBackupController } from './database-backup.controller';
import { DatabaseBackupService } from './database-backup.service';
import { BackupDestinationsController } from './backup-destinations.controller';
import { BackupDestinationsService } from './backup-destinations.service';

@Module({
  // AuthModule é necessário aqui, além de ServersModule: os controllers usam
  // @UseGuards(JwtAuthGuard, RolesGuard), e RolesGuard/JwtAuthGuard só são
  // resolvíveis via DI se o módulo que os usa importar AuthModule (que os
  // exporta) — ServersModule importa AuthModule mas não o reexporta (seu
  // `exports` só tem ServersService/SshService), então sem esta linha o Nest
  // não consegue montar os guards e a resolução de dependências trava
  // ("Maximum call stack size exceeded" / estado inconsistente do
  // ThrottlerGuard). Mesmo padrão de ApplicationsModule e GitAccountsModule,
  // que importam AuthModule direto pelo mesmo motivo.
  //
  // Não existe um SshModule separado — SshService é provido e exportado
  // pelo próprio ServersModule (ver servers.module.ts), mesmo jeito que
  // ApplicationsModule/GitAccountsModule já importam pra usar SSH.
  imports: [AuthModule, ServersModule],
  controllers: [DatabaseBackupController, BackupDestinationsController],
  providers: [DatabaseBackupService, BackupDestinationsService],
  exports: [DatabaseBackupService],
})
export class DatabaseBackupModule {}
