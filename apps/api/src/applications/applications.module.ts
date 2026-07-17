import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { TraefikModule } from '../traefik/traefik.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [AuthModule, ServersModule, TraefikModule, CatalogModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
