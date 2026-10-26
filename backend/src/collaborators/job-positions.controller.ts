import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';
import { JobPositionsService } from './job-positions.service';

@ApiTags('job-positions')
@Controller('job-positions')
@RequirePermissions('job-positions:manage')
export class JobPositionsController {
  constructor(private readonly positions: JobPositionsService) {}
  /** Todo el catálogo, incluidos los cargos inactivos, con sus colaboradores activos. */
  @Get() list() {
    return this.positions.list();
  }
  @Post() create(@Body() dto: CreateJobPositionDto, @Req() request: AuthenticatedRequest) {
    return this.positions.create(dto, request);
  }
  @Patch(':id') update(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Body() dto: UpdateJobPositionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.positions.update(id, dto, request);
  }
}
