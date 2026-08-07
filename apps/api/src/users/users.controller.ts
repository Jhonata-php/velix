import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { MinRole, RolesGuard, type Role } from '../auth/roles.guard';
import { UsersService, CreateUserInput } from './users.service';

type AuthedRequest = Request & { user: AuthenticatedUser };

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@MinRole('admin')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  create(@Body() dto: CreateUserInput) {
    return this.users.create(dto);
  }

  @Patch(':id/role')
  setRole(@Param('id') id: string, @Body('role') role: Role, @Req() req: AuthedRequest) {
    return this.users.setRole(id, role, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthedRequest) {
    return this.users.remove(id, req.user.sub);
  }
}
