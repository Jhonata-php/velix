import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VersionModule } from '../version/version.module';
import { PushModule } from '../push/push.module';
import { GitHubReleaseService } from './github-release.service';
import { UpdateService } from './update.service';
import { SelfUpdateService } from './self-update.service';
import { UpdateController } from './update.controller';

@Module({
  imports: [AuthModule, VersionModule, PushModule],
  providers: [GitHubReleaseService, UpdateService, SelfUpdateService],
  controllers: [UpdateController],
})
export class UpdateModule {}
