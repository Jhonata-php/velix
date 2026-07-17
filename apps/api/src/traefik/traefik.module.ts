import { Module } from '@nestjs/common';
import { TraefikController } from './traefik.controller';
import { TraefikService } from './traefik.service';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { CloudflareModule } from '../cloudflare/cloudflare.module';

@Module({
  imports: [AuthModule, ServersModule, CloudflareModule],
  controllers: [TraefikController],
  providers: [TraefikService],
  exports: [TraefikService],
})
export class TraefikModule {}
