import * as argon2 from 'argon2';
import { ConflictException, Injectable } from '@nestjs/common';
import type { Collaborator } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCollaboratorDto } from './dto/create-collaborator.dto';
import { UpdateCollaboratorDto } from './dto/update-collaborator.dto';

@Injectable()
export class CollaboratorsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCollaboratorDto, request: AuthenticatedRequest) {
    const existing = await this.prisma.collaborator.findUnique({
      where: { documentNumber: dto.documentNumber.trim() },
    });
    if (existing) throw new ConflictException('Ya existe un colaborador con ese documento.');
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const collaborator = await this.prisma.$transaction(async (tx) => {
      const created = await tx.collaborator.create({
        data: {
          documentType: dto.documentType.trim(),
          documentNumber: dto.documentNumber.trim(),
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          email: dto.email?.trim().toLowerCase(),
          phone: dto.phone?.trim(),
          jobTitle: dto.jobTitle?.trim(),
          team: dto.team?.trim(),
          pinHash: await argon2.hash(dto.pin, { type: argon2.argon2id }),
          createdById: actorUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_COLLABORATOR',
          entityType: 'COLLABORATOR',
          entityId: created.id,
          afterJson: {
            documentType: created.documentType,
            documentNumber: created.documentNumber,
            firstName: created.firstName,
            lastName: created.lastName,
            status: created.status,
          },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return created;
    });
    return this.serialize(collaborator);
  }

  async list() {
    return (await this.prisma.collaborator.findMany({ orderBy: { createdAt: 'desc' } })).map((item) =>
      this.serialize(item),
    );
  }

  async update(id: string, dto: UpdateCollaboratorDto, request: AuthenticatedRequest) {
    const previous = await this.prisma.collaborator.findUniqueOrThrow({ where: { id } });
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const collaborator = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.collaborator.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(dto.jobTitle !== undefined ? { jobTitle: dto.jobTitle.trim() || null } : {}),
          ...(dto.team !== undefined ? { team: dto.team.trim() || null } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.pin ? { pinHash: await argon2.hash(dto.pin, { type: argon2.argon2id }) } : {}),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'UPDATE_COLLABORATOR',
          entityType: 'COLLABORATOR',
          entityId: id,
          beforeJson: this.auditData(previous),
          afterJson: this.auditData(updated),
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return updated;
    });
    return this.serialize(collaborator);
  }

  private auditData(collaborator: Collaborator) {
    return {
      documentNumber: collaborator.documentNumber,
      firstName: collaborator.firstName,
      lastName: collaborator.lastName,
      email: collaborator.email,
      phone: collaborator.phone,
      jobTitle: collaborator.jobTitle,
      team: collaborator.team,
      status: collaborator.status,
    };
  }
  private serialize({
    pinHash: _pinHash,
    failedLoginAttempts: _attempts,
    lockedUntil: _locked,
    ...collaborator
  }: Collaborator) {
    return collaborator;
  }
}
