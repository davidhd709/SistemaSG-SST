import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEventInput {
  actorUserId?: string;
  actorCollaboratorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  beforeJson?: Prisma.InputJsonValue;
  afterJson?: Prisma.InputJsonValue;
  reason?: string;
  ip?: string;
  userAgent?: string;
  correlationId: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({ data: input });
  }
}
