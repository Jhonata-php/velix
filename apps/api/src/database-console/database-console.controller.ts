import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard } from '../auth/roles.guard';
import { DatabaseConsoleService } from './database-console.service';
import { RunQueryDto } from './dto/run-query.dto';
import { CreateSchemaDto } from './dto/create-schema.dto';
import { UpdateRowDto } from './dto/update-row.dto';
import { DeleteRowDto } from './dto/delete-row.dto';

type AuthedRequest = Request & { user: AuthenticatedUser };

// Mesmo prefixo 'databases' de DatabaseBackupController — rotas não colidem
// porque cada uma declara um caminho de método diferente
// (:id/tables, :id/tables/:table/rows, :id/query, :id/query-log, :id/schemas).
@Controller('databases')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DatabaseConsoleController {
  constructor(private readonly console: DatabaseConsoleService) {}

  @Get(':id/schemas')
  listSchemas(@Param('id') id: string) {
    return this.console.listSchemas(id);
  }

  @Post(':id/schemas')
  @MinRole('operator')
  async createSchema(@Param('id') id: string, @Body() dto: CreateSchemaDto) {
    await this.console.createDatabase(id, dto.name);
    return { ok: true };
  }

  @Delete(':id/schemas/:name')
  @MinRole('operator')
  async dropSchema(@Param('id') id: string, @Param('name') name: string) {
    await this.console.dropDatabase(id, name);
    return { ok: true };
  }

  @Get(':id/tables')
  listTables(@Param('id') id: string, @Query('database') database?: string) {
    return this.console.listTables(id, database);
  }

  @Get(':id/tables/:table/rows')
  getRows(
    @Param('id') id: string,
    @Param('table') table: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('database') database?: string,
  ) {
    return this.console.getRows(id, table, {
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      search,
      database,
    });
  }

  @Patch(':id/tables/:table/rows')
  @MinRole('operator')
  updateRow(@Param('id') id: string, @Param('table') table: string, @Body() dto: UpdateRowDto, @Req() req: AuthedRequest) {
    return this.console.updateRow(id, req.user.sub, table, { pk: dto.pk, changes: dto.changes, database: dto.database });
  }

  @Delete(':id/tables/:table/rows')
  @MinRole('operator')
  deleteRow(@Param('id') id: string, @Param('table') table: string, @Body() dto: DeleteRowDto, @Req() req: AuthedRequest) {
    return this.console.deleteRow(id, req.user.sub, table, { pk: dto.pk, database: dto.database });
  }

  @Post(':id/query')
  @MinRole('operator')
  runQuery(@Param('id') id: string, @Body() dto: RunQueryDto, @Req() req: AuthedRequest) {
    return this.console.runQuery(id, req.user.sub, dto.sql, dto.database);
  }

  @Get(':id/query-log')
  listQueryLog(@Param('id') id: string) {
    return this.console.listQueryLog(id);
  }
}
