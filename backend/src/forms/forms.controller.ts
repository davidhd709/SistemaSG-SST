import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import { FormsService } from './forms.service';
@ApiTags('forms')
@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}
  @Get(':code/current') current(@Param('code') code: string) {
    return this.forms.getCurrent(code);
  }
  @Post() @RequirePermissions('forms:manage') create(@Body() dto: CreateFormDto, @Req() request: AuthenticatedRequest) {
    return this.forms.create(dto, request);
  }
  @Post(':id/versions') @RequirePermissions('forms:manage') version(
    @Param('id') id: string,
    @Body() dto: CreateFormVersionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forms.createVersion(id, dto, request);
  }
  @Post(':id/versions/:versionId/publish') @RequirePermissions('forms:manage') publish(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forms.publish(id, versionId, request);
  }
}
