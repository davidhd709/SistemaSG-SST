import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { ReportRangeDto } from './dto/report-range.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@Controller('reports')
@RequirePermissions('reports:read')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Libro de Excel con resumen, permisos, rechazos y cumplimiento actual. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('submissions.xlsx')
  async submissions(
    @Query() query: ReportRangeDto,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.reports.submissionsWorkbook(query.from, query.to, request, query.site);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(buffer);
  }
}
