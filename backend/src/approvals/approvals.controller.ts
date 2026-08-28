import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { ApprovalsService } from './approvals.service';
import { DecideSubmissionDto } from './dto/decide-submission.dto';
@ApiTags('coordination')
@Controller('coordination')
@RequirePermissions('submissions:review')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}
  @Get('dashboard') dashboard() {
    return this.approvals.dashboard();
  }
  @Get('submissions/pending') pending() {
    return this.approvals.pending();
  }
  @Get('submissions/:id') detail(@Param('id') id: string) {
    return this.approvals.detail(id);
  }
  @Post('submissions/:id/decision') decide(
    @Param('id') id: string,
    @Body() dto: DecideSubmissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.approvals.decide(id, dto, request);
  }
}
