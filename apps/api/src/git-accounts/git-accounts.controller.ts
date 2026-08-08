import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GitAccountsService, CreateGitAccountInput } from './git-accounts.service';
import { GitHubAppService } from './github-app.service';

@Controller('git-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class GitAccountsController {
  constructor(
    private readonly accounts: GitAccountsService,
    private readonly githubApp: GitHubAppService,
  ) {}

  @Get()
  list() {
    return this.accounts.list();
  }

  @Post()
  @MinRole('admin')
  create(@Body() dto: CreateGitAccountInput) {
    return this.accounts.create(dto);
  }

  /** Etapa 1 do fluxo "Conectar com GitHub" — ver github-app.service.ts.
   * Devolve o manifest pro frontend montar e submeter o form pro GitHub;
   * as etapas de volta (callback/installed) são públicas, ver
   * github-app-callback.controller.ts. */
  @Post('github/manifest')
  @MinRole('admin')
  startGitHubApp(@Body('label') label: string) {
    return this.githubApp.startManifest(label);
  }

  @Delete(':id')
  @MinRole('admin')
  remove(@Param('id') id: string) {
    return this.accounts.remove(id);
  }
}
