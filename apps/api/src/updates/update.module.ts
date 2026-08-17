import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VersionModule } from '../version/version.module';
import { GitHubReleaseService } from './github-release.service';
import { UpdateService } from './update.service';
import { SelfUpdateService } from './self-update.service';
import { PlatformWebhookService } from './platform-webhook.service';
import { UpdateController } from './update.controller';
import { PlatformWebhookController } from './platform-webhook.controller';

@Module({
  imports: [AuthModule, VersionModule],
  providers: [GitHubReleaseService, UpdateService, SelfUpdateService, PlatformWebhookService],
  controllers: [UpdateController, PlatformWebhookController],
})
export class UpdateModule {}
