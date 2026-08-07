import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GitAccountsController } from './git-accounts.controller';
import { GitAccountsService } from './git-accounts.service';

@Module({
  imports: [AuthModule],
  controllers: [GitAccountsController],
  providers: [GitAccountsService],
  exports: [GitAccountsService],
})
export class GitAccountsModule {}
