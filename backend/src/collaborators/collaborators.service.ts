import * as argon2 from 'argon2';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { Collaborator, JobPosition } from '@prisma/client';
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
    const position = await this.resolvePosition(dto.jobPositionId, dto.jobTitle);
    if (position?.canLead && !dto.pin) {
      throw new BadRequestException('Los cargos habilitados para liderar deben tener un PIN de acceso.');
    }
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
          jobTitle: position?.name,
          jobPositionId: position?.id,
          team: dto.team?.trim(),
          pinHash: position?.canLead && dto.pin ? await argon2.hash(dto.pin, { type: argon2.argon2id }) : null,
          createdById: actorUserId,
        },
        include: { jobPosition: true },
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
    return (
      await this.prisma.collaborator.findMany({ include: { jobPosition: true }, orderBy: { createdAt: 'desc' } })
    ).map((item) => this.serialize(item));
  }

  async jobPositions() {
    return this.prisma.jobPosition.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, canLead: true },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, dto: UpdateCollaboratorDto, request: AuthenticatedRequest) {
    const previous = await this.prisma.collaborator.findUniqueOrThrow({
      where: { id },
      include: { jobPosition: true },
    });
    const positionChanged = dto.jobPositionId !== undefined || dto.jobTitle !== undefined;
    const position = positionChanged
      ? await this.resolvePosition(dto.jobPositionId, dto.jobTitle)
      : previous.jobPosition;
    if (position?.canLead && !previous.pinHash && !dto.pin) {
      throw new BadRequestException('Los cargos habilitados para liderar deben tener un PIN de acceso.');
    }
    const pinRemoved = positionChanged && !position?.canLead && !!previous.pinHash;
    const pinChanged = (position?.canLead && !!dto.pin) || pinRemoved;
    const inactivated = dto.status === 'INACTIVE' && previous.status !== 'INACTIVE';
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const collaborator = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.collaborator.update({
        where: { id },
        data: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName.trim() } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName.trim() } : {}),
          ...(dto.email !== undefined ? { email: dto.email.trim().toLowerCase() || null } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
          ...(positionChanged ? { jobTitle: position?.name ?? null, jobPositionId: position?.id ?? null } : {}),
          ...(dto.team !== undefined ? { team: dto.team.trim() || null } : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(positionChanged && !position?.canLead
            ? { pinHash: null }
            : dto.pin
              ? { pinHash: await argon2.hash(dto.pin, { type: argon2.argon2id }) }
              : {}),
        },
        include: { jobPosition: true },
      });
      if (pinChanged || inactivated) {
        await tx.refreshSession.updateMany({
          where: { collaboratorId: id, revokedAt: null, expiresAt: { gt: new Date() } },
          data: { revokedAt: new Date() },
        });
      }
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'UPDATE_COLLABORATOR',
          entityType: 'COLLABORATOR',
          entityId: id,
          beforeJson: this.auditData(previous),
          afterJson: { ...this.auditData(updated), pinChanged, sessionsRevoked: pinChanged || inactivated },
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
  private async resolvePosition(jobPositionId?: string | null, legacyTitle?: string): Promise<JobPosition | null> {
    if (!jobPositionId && !legacyTitle?.trim()) return null;
    const position = await this.prisma.jobPosition.findFirst({
      where: jobPositionId ? { id: jobPositionId, active: true } : { name: legacyTitle!.trim(), active: true },
    });
    if (!position) throw new BadRequestException('El cargo no existe o está inactivo.');
    return position;
  }
  private serialize({
    pinHash: _pinHash,
    failedLoginAttempts: _attempts,
    lockedUntil: _locked,
    ...collaborator
  }: Collaborator & { jobPosition?: JobPosition | null }) {
    return collaborator;
  }
}
