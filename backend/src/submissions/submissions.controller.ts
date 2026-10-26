import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/request-context';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { SubmitFormDto } from './dto/submit-form.dto';
import { CloseWorkdayDto } from './dto/close-workday.dto';
import { SafetyTalkChallengeDto } from './dto/safety-talk-challenge.dto';
import { MySubmissionsQueryDto } from './dto/my-submissions-query.dto';
import { SubmissionsService } from './submissions.service';

@ApiTags('submissions')
@Controller('submissions')
export class SubmissionsController {
  constructor(private readonly submissions: SubmissionsService) {}

  /** Estado del colaborador frente a un formato (`?form=CÓDIGO`; por defecto, alturas). */
  @Get('workflow') workflow(@Query('form') form: string | undefined, @Req() request: AuthenticatedRequest) {
    return this.submissions.workflow(request, form || undefined);
  }

  /** Colaboradores que hoy pueden integrar la cuadrilla del formato. */
  @Get('crew-candidates') crewCandidates(
    @Query('form') form: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.submissions.crewCandidates(request, form || undefined);
  }

  @Get('job-positions') jobPositions() {
    return this.submissions.jobPositions();
  }

  /** Permisos en los que participó el colaborador, del más reciente al más antiguo. */
  @Get('mine') mine(@Query() query: MySubmissionsQueryDto, @Req() request: AuthenticatedRequest) {
    return this.submissions.mine(request, query);
  }

  @Get('mine/latest') latest(@Query('form') form: string | undefined, @Req() request: AuthenticatedRequest) {
    return this.submissions.latest(request, form || undefined);
  }

  /** Datos de un permiso rechazado para corregirlo y reenviarlo. */
  @Get('mine/:id/correction') correction(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.submissions.correctionSource(id, request);
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
  start(@Param('id', UUID_PARAM_PIPE) id: string, @Req() request: AuthenticatedRequest) {
    return this.submissions.startWorkday(id, request);
  }

  /** Cierra la jornada y deja el permiso listo para su documento final. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/close')
  close(@Param('id', UUID_PARAM_PIPE) id: string, @Body() dto: CloseWorkdayDto, @Req() request: AuthenticatedRequest) {
    return this.submissions.closeWorkday(id, dto, request);
  }
}
