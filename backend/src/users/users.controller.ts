import { Body, Controller, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangeOwnPasswordDto } from './dto/change-own-password.dto';
import { RegisterSignatureDto } from './dto/register-signature.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @Get('me') me(@Req() request: AuthenticatedRequest) {
    return request.principal?.kind === 'USER' ? this.users.me(request.principal.userId) : null;
  }
  @Patch('me/password') changeOwnPassword(@Body() dto: ChangeOwnPasswordDto, @Req() request: AuthenticatedRequest) {
    return this.users.changeOwnPassword(dto, request);
  }
  /** Nombre y firma que se estampan en los formatos que el usuario aprueba. */
  @Get('me/signature') mySignature(@Req() request: AuthenticatedRequest) {
    return this.users.mySignature(request);
  }
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Put('me/signature')
  registerSignature(@Body() dto: RegisterSignatureDto, @Req() request: AuthenticatedRequest) {
    return this.users.registerSignature(dto, request);
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
  @Patch(':id') @RequirePermissions('users:manage') update(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Body() dto: UpdateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.update(id, dto, request);
  }
}
