import { Module } from '@nestjs/common';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';
import { GitDeployService } from './git-deploy.service';
import { WebhooksController } from './webhooks.controller';
import { GitAccountsModule } from '../git-accounts/git-accounts.module';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { TraefikModule } from '../traefik/traefik.module';
import { CatalogModule } from '../catalog/catalog.module';

@Module({
  imports: [AuthModule, ServersModule, TraefikModule, CatalogModule, GitAccountsModule],
  controllers: [ApplicationsController, WebhooksController],
  providers: [ApplicationsService, GitDeployService],
  exports: [ApplicationsService, GitDeployService],
})
export class ApplicationsModule {}
