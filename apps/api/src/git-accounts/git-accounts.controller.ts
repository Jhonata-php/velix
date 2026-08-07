import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GitAccountsService, CreateGitAccountInput } from './git-accounts.service';

@Controller('git-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GitAccountsController {
  constructor(private readonly accounts: GitAccountsService) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Post()
  @MinRole('admin')
  create(@Body() dto: CreateGitAccountInput) {
    return this.accounts.create(dto);
  }

  @Delete(':id')
  @MinRole('admin')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
