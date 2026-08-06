import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { LocalServerService } from './local-server.service';
import { SshService } from '../ssh/ssh.service';
import { AuthModule } from '../auth/auth.module';
import { CloudflareModule } from '../cloudflare/cloudflare.module';

@Module({
  imports: [AuthModule, CloudflareModule],
  controllers: [ServersController],
  providers: [ServersService, SshService, LocalServerService],
  exports: [ServersService, SshService],
})
export class ServersModule {}
