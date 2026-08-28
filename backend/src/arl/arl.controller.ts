import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { ArlService } from './arl.service';
import type { ArlStatus } from './arl-status';
import { CreateArlAffiliationDto } from './dto/create-arl-affiliation.dto';
import { UpdateArlAffiliationDto } from './dto/update-arl-affiliation.dto';

@ApiTags('arl')
@Controller('arl')
export class ArlController {
  constructor(private readonly arl: ArlService) {}
  @Get() @RequirePermissions('arl:read') list(@Query('status') status?: ArlStatus) {
    return this.arl.list(status);
  }
  @Get('collaborators/:collaboratorId/history') @RequirePermissions('arl:read') history(
    @Param('collaboratorId') collaboratorId: string,
  ) {
    return this.arl.history(collaboratorId);
  }
  @Post('affiliations') @RequirePermissions('arl:manage') create(
    @Body() dto: CreateArlAffiliationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arl.create(dto, request);
  }
  @Patch('affiliations/:id') @RequirePermissions('arl:manage') update(
    @Param('id') id: string,
    @Body() dto: UpdateArlAffiliationDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arl.update(id, dto, request);
  }
  @Post('affiliations/:id/documents')
  @RequirePermissions('arl:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  attach(
    @Param('id') id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.arl.attachDocument(id, file, request);
  }
}
