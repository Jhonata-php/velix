import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { DatabaseConsoleService } from './database-console.service';
import { RunQueryDto } from './dto/run-query.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

// Mesmo prefixo 'databases' de DatabaseBackupController — rotas não colidem
// porque cada uma declara um caminho de método diferente
// (:id/tables, :id/tables/:table/rows, :id/query, :id/query-log).
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseConsoleController {
  constructor(private readonly console: DatabaseConsoleService) {}

  @Get(':id/tables')
  listTables(@Param('id') id: string) {
    return this.console.listTables(id);
  }

  @Get(':id/tables/:table/rows')
  getRows(
    @Param('id') id: string,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    return this.console.getRows(id, table, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      search,
    });
  }

  @Post(':id/query')
  @MinRole('operator')
  runQuery(@Param('id') id: string, @Body() dto: RunQueryDto, @Req() req: AuthedRequest) {
    return this.console.runQuery(id, req.user.sub, dto.sql);
  }

  @Get(':id/query-log')
  listQueryLog(@Param('id') id: string) {
    return this.console.listQueryLog(id);
  }
}
