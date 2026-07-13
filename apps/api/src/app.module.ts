import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ServersModule } from './servers/servers.module';

@Module({
  imports: [PrismaModule, AuthModule, ServersModule],
})
export class AppModule {}
