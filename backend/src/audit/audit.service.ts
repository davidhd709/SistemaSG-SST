import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async record(input: AuditEventInput): Promise<void> {
    if (!this.enabled()) return;
    await this.prisma.auditEvent.create({ data: input });
  }

  private enabled(): boolean {
    const configured = this.config.get<string>('AUDIT_ENABLED');
    if (configured !== undefined) return configured.trim().toLowerCase() === 'true';
    return this.config.get<string>('NODE_ENV') === 'production';
  }
}
