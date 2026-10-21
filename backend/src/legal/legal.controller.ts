import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { LegalService } from './legal.service';
@ApiTags('legal')
@Controller('legal')
@RequirePermissions('legal:read')
export class LegalController {
  constructor(private readonly legal: LegalService) {}
  @Get('collaborators') search(@Query('q') q?: string) {
    return this.legal.search(q);
  }
  @Get('collaborators/:id/history') history(@Param('id', UUID_PARAM_PIPE) id: string) {
    return this.legal.history(id);
  }
}
