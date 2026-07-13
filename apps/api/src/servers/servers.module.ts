import { Module } from '@nestjs/common';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';
import { SshService } from '../ssh/ssh.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ServersController],
  providers: [ServersService, SshService],
})
export class ServersModule {}
