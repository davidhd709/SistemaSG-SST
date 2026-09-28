import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/request-context';
import { SubmitFormDto } from './dto/submit-form.dto';
import { CloseWorkdayDto } from './dto/close-workday.dto';
import { SafetyTalkChallengeDto } from './dto/safety-talk-challenge.dto';
import { SubmissionsService } from './submissions.service';

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  @Get('workflow') workflow(@Req() request: AuthenticatedRequest) {
    return this.submissions.workflow(request);
  }

  /** Colaboradores que hoy pueden integrar la cuadrilla. */
  @Get('crew-candidates') crewCandidates(@Req() request: AuthenticatedRequest) {
    return this.submissions.crewCandidates(request);
  }

  @Get('job-positions') jobPositions() {
    return this.submissions.jobPositions();
  }

  @Get('mine/latest') latest(@Req() request: AuthenticatedRequest) {
    return this.submissions.latest(request);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('safety-talk/challenge')
  challenge(@Body() dto: SafetyTalkChallengeDto, @Req() request: AuthenticatedRequest) {
    return this.submissions.safetyTalkChallenge(dto.videoId, request);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('forms/:code')
  submit(@Param('code') code: string, @Body() dto: SubmitFormDto, @Req() request: AuthenticatedRequest) {
    return this.submissions.submit(code, dto, request);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/start')
  start(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.submissions.startWorkday(id, request);
  }

  /** Cierra la jornada y deja el permiso listo para su documento final. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseWorkdayDto, @Req() request: AuthenticatedRequest) {
    return this.submissions.closeWorkday(id, dto, request);
  }
}
