import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { FilesService } from './files.service';

@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ): Promise<void> {
    const { file, content } = await this.files.download(id, request.principal);
    await this.audit.record({
      actorUserId: request.principal?.kind === 'USER' ? request.principal.userId : undefined,
      actorCollaboratorId: request.principal?.kind === 'COLLABORATOR' ? request.principal.collaboratorId : undefined,
      action: 'DOWNLOAD_FILE',
      entityType: 'FILE_OBJECT',
      entityId: id,
      ip: request.ip,
      userAgent: request.header('user-agent'),
      correlationId: request.correlationId ?? 'unknown',
    });
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Disposition', `attachment; filename="${file.originalName.replace(/"/g, '')}"`);
    response.send(content);
  }
}
