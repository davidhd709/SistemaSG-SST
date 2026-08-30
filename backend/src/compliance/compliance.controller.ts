import { Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import type { AuthenticatedRequest } from '../common/request-context';
import { ComplianceAdminService } from './compliance-admin.service';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { CreateHeightCertificateDto } from './dto/create-height-certificate.dto';

type Subida = { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined;

@ApiTags('compliance')
@Controller('compliance')
export class ComplianceController {
  constructor(private readonly admin: ComplianceAdminService) {}

  /** Quién está al día y quién no, para toda la plantilla. */
  @Get('overview') @RequirePermissions('compliance:read') overview() {
    return this.admin.overview();
  }

  // ── Planillas de seguridad social ──
  @Get('payrolls') @RequirePermissions('compliance:read') listPayrolls() {
    return this.admin.listPayrolls();
  }

  @Post('payrolls') @RequirePermissions('compliance:manage') createPayroll(
    @Body() dto: CreatePayrollDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.createPayroll(dto, request);
  }

  @Patch('payrolls/:id') @RequirePermissions('compliance:manage') updatePayroll(
    @Param('id') id: string,
    @Body() dto: UpdatePayrollDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.updatePayroll(id, dto, request);
  }

  @Post('payrolls/:id/file')
  @RequirePermissions('compliance:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  attachPayrollFile(@Param('id') id: string, @UploadedFile() file: Subida, @Req() request: AuthenticatedRequest) {
    return this.admin.attachPayrollFile(id, file, request);
  }

  // ── Certificados de alturas ──
  @Get('height-certificates') @RequirePermissions('compliance:read') listCertificates(
    @Query('collaboratorId') collaboratorId?: string,
  ) {
    return this.admin.listHeightCertificates(collaboratorId);
  }

  @Post('height-certificates') @RequirePermissions('compliance:manage') createCertificate(
    @Body() dto: CreateHeightCertificateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.admin.createHeightCertificate(dto, request);
  }

  @Post('height-certificates/:id/file')
  @RequirePermissions('compliance:manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  attachCertificateFile(@Param('id') id: string, @UploadedFile() file: Subida, @Req() request: AuthenticatedRequest) {
    return this.admin.attachCertificateFile(id, file, request);
  }
}
