import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/auth.decorators';
import { PrismaService } from '../prisma/prisma.service';
@ApiTags('audit')
@Controller('audit')
@RequirePermissions('audit:read')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('take') take = '50',
  ) {
    const amount = Math.min(Math.max(Number(take) || 50, 1), 200);
    return this.prisma.auditEvent.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(action ? { action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: amount,
      include: {
        actorUser: { select: { email: true } },
        actorCollaborator: { select: { firstName: true, lastName: true } },
      },
    });
  }
}
