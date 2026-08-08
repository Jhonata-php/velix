import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GitAccountsController } from './git-accounts.controller';
import { GitAccountsService } from './git-accounts.service';
import { GitHubAppService } from './github-app.service';
import { GitHubAppCallbackController } from './github-app-callback.controller';

@Module({
  imports: [AuthModule],
  controllers: [GitAccountsController, GitHubAppCallbackController],
  providers: [GitAccountsService, GitHubAppService],
  exports: [GitAccountsService],
})
export class GitAccountsModule {}
