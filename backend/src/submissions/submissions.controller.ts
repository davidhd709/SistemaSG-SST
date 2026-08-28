import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../common/request-context';
import { SubmitFormDto } from './dto/submit-form.dto';
import { SubmissionsService } from './submissions.service';
@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}
  @Get('workflow') workflow(@Req() request: AuthenticatedRequest) {
    return this.submissions.workflow(request);
  }
  @Get('mine/latest') latest(@Req() request: AuthenticatedRequest) {
    return this.submissions.latest(request);
  }
  @Post('forms/:code') submit(
    @Param('code') code: string,
    @Body() dto: SubmitFormDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.submissions.submit(code, dto, request);
  }
}
