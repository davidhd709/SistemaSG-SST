import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { CreateFormDto } from './dto/create-form.dto';
import { CheckFormVersionDto, CreateFormVersionDto } from './dto/create-form-version.dto';
import { FormsService } from './forms.service';
@ApiTags('forms')
@Controller('forms')
export class FormsController {
  constructor(private readonly forms: FormsService) {}
  /** Formatos con su historial de versiones. */
  @Get() @RequirePermissions('forms:manage') list() {
    return this.forms.list();
  }
  @Get(':code/current') current(@Param('code') code: string) {
    return this.forms.getCurrent(code);
  }
  @Get(':id/versions/:versionId') @RequirePermissions('forms:manage') getVersion(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Param('versionId', UUID_PARAM_PIPE) versionId: string,
  ) {
    return this.forms.getVersion(id, versionId);
  }
  /** Revisa un esquema contra el PDF oficial sin guardarlo. */
  @Post(':id/versions/check') @RequirePermissions('forms:manage') check(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Body() dto: CheckFormVersionDto,
  ) {
    return this.forms.checkVersion(id, dto.schemaJson);
  }
  @Post() @RequirePermissions('forms:manage') create(@Body() dto: CreateFormDto, @Req() request: AuthenticatedRequest) {
    return this.forms.create(dto, request);
  }
  @Post(':id/versions') @RequirePermissions('forms:manage') version(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Body() dto: CreateFormVersionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forms.createVersion(id, dto, request);
  }
  @Post(':id/versions/:versionId/publish') @RequirePermissions('forms:manage') publish(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Param('versionId', UUID_PARAM_PIPE) versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.forms.publish(id, versionId, request);
  }
}
