import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GitAccountsService, CreateGitAccountInput } from './git-accounts.service';

@Controller('git-accounts')
@UseGuards(JwtAuthGuard)
export class GitAccountsController {
  constructor(private readonly accounts: GitAccountsService) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Post()
  create(@Body() dto: CreateGitAccountInput) {
    return this.accounts.create(dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
