import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me') me(@Req() request: AuthenticatedRequest) {
    return request.principal?.kind === 'USER' ? this.users.me(request.principal.userId) : null;
  }
  @Get('roles') @RequirePermissions('roles:read') roles() {
    return this.users.listRoles();
  }
  @Get() @RequirePermissions('users:read') list() {
    return this.users.list();
  }
  @Post() @RequirePermissions('users:create') create(@Body() dto: CreateUserDto, @Req() request: AuthenticatedRequest) {
    return this.users.create(dto, request);
  }
  @Patch(':id') @RequirePermissions('users:read') update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, dto, request);
  }
}
