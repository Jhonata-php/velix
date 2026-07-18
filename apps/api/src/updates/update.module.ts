import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VersionModule } from '../version/version.module';
import { GitHubReleaseService } from './github-release.service';
import { UpdateService } from './update.service';
import { UpdateController } from './update.controller';

@Module({
  imports: [AuthModule, VersionModule],
  providers: [GitHubReleaseService, UpdateService],
  controllers: [UpdateController],
})
export class UpdateModule {}
