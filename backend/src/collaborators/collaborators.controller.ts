import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/request-context';
import { RequirePermissions } from '../auth/auth.decorators';
import { CollaboratorsService } from './collaborators.service';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';

@ApiTags('collaborators')
@Controller('collaborators')
export class CollaboratorsController {
  constructor(private readonly collaborators: CollaboratorsService) {}
  @Get() @RequirePermissions('collaborators:read') list() {
    return this.collaborators.list();
  }
  @Post() @RequirePermissions('collaborators:create') create(
    @Body() dto: CreateCollaboratorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.collaborators.create(dto, request);
  }
  @Patch(':id') @RequirePermissions('collaborators:read') update(
    @Param('id') id: string,
    @Body() dto: UpdateCollaboratorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.collaborators.update(id, dto, request);
  }
}
