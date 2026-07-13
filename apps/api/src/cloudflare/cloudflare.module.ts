import { Module } from '@nestjs/common';
import { CloudflareController } from './cloudflare.controller';
import { CloudflareService } from './cloudflare.service';
import { CloudflareApiService } from './cloudflare-api.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [CloudflareController],
  providers: [CloudflareService, CloudflareApiService],
})
export class CloudflareModule {}
