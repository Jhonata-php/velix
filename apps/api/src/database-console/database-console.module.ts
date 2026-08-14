import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { CatalogModule } from '../catalog/catalog.module';
import { DatabaseConsoleController } from './database-console.controller';
import { DatabaseConsoleService } from './database-console.service';
import { DatabaseTunnelService } from './database-tunnel.service';

@Module({
  // AuthModule (guards) e ServersModule (SshService/ServersService) — mesmo
  // motivo documentado em DatabaseBackupModule: sem AuthModule aqui, o Nest
  // não resolve JwtAuthGuard/RolesGuard por DI.
  imports: [AuthModule, ServersModule, CatalogModule],
  controllers: [DatabaseConsoleController],
  providers: [DatabaseConsoleService, DatabaseTunnelService],
})
export class DatabaseConsoleModule {}
