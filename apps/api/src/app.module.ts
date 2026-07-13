import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';
import { CloudflareModule } from './cloudflare/cloudflare.module';

@Module({
  imports: [PrismaModule, AuthModule, ServersModule, CloudflareModule],
})
export class AppModule {}
