import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ArlAffiliation } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { calculateArlStatus, type ArlStatus } from './arl-status';
import { CreateArlAffiliationDto } from './dto/create-arl-affiliation.dto';
import { UpdateArlAffiliationDto } from './dto/update-arl-affiliation.dto';
import { StorageService } from '../files/storage.service';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

@Injectable()
export class ArlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(status?: ArlStatus) {
    const days = await this.getExpiringDays();
    const collaborators = await this.prisma.collaborator.findMany({
      include: { arlAffiliations: { orderBy: { endDate: 'desc' } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const result = collaborators.map((collaborator) => {
      const affiliation = collaborator.arlAffiliations[0];
      const arlStatus = affiliation ? calculateArlStatus(affiliation.startDate, affiliation.endDate, days) : 'VENCIDA';
      return {
        collaborator: {
          id: collaborator.id,
          documentNumber: collaborator.documentNumber,
          firstName: collaborator.firstName,
          lastName: collaborator.lastName,
          status: collaborator.status,
        },
        affiliation: affiliation ? this.serialize(affiliation, days) : null,
        arlStatus,
      };
    });
    return status ? result.filter((item) => item.arlStatus === status) : result;
  }

  async history(collaboratorId: string) {
    const days = await this.getExpiringDays();
    const affiliations = await this.prisma.arlAffiliation.findMany({
      where: { collaboratorId },
      include: { documents: true },
      orderBy: { endDate: 'desc' },
    });
    return affiliations.map((item) => this.serialize(item, days));
  }

  async create(dto: CreateArlAffiliationDto, request: AuthenticatedRequest) {
    const startDate = this.parseDate(dto.startDate);
    const endDate = this.parseDate(dto.endDate);
    this.validateDates(startDate, endDate);
    const collaborator = await this.prisma.collaborator.findUnique({ where: { id: dto.collaboratorId } });
    if (!collaborator) throw new NotFoundException('Colaborador no encontrado.');
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const affiliation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.arlAffiliation.create({
        data: {
          collaboratorId: dto.collaboratorId,
          providerName: dto.providerName.trim(),
          startDate,
          endDate,
          createdById: actorUserId,
          updatedById: actorUserId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_ARL_AFFILIATION',
          entityType: 'ARL_AFFILIATION',
          entityId: created.id,
          afterJson: this.auditShape(created),
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return created;
    });
    return this.serialize(affiliation, await this.getExpiringDays());
  }

  async update(id: string, dto: UpdateArlAffiliationDto, request: AuthenticatedRequest) {
    const existing = await this.prisma.arlAffiliation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Afiliación ARL no encontrada.');
    const startDate = dto.startDate ? this.parseDate(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? this.parseDate(dto.endDate) : existing.endDate;
    this.validateDates(startDate, endDate);
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const affiliation = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.arlAffiliation.update({
        where: { id },
        data: { providerName: dto.providerName?.trim(), startDate, endDate, updatedById: actorUserId },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'UPDATE_ARL_AFFILIATION',
          entityType: 'ARL_AFFILIATION',
          entityId: id,
          beforeJson: this.auditShape(existing),
          afterJson: this.auditShape(updated),
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return updated;
    });
    return this.serialize(affiliation, await this.getExpiringDays());
  }

  async attachDocument(
    affiliationId: string,
    upload: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
    request: AuthenticatedRequest,
  ) {
    if (!upload || !upload.buffer || upload.size <= 0 || upload.size > 10 * 1024 * 1024)
      throw new BadRequestException('El soporte debe pesar máximo 10 MB.');
    const mimeType = this.detectMime(upload.buffer);
    const extension = extname(upload.originalname).toLowerCase();
    const expectedExtensions: Record<string, string[]> = {
      'application/pdf': ['.pdf'],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    };
    if (!mimeType || mimeType !== upload.mimetype || !expectedExtensions[mimeType].includes(extension))
      throw new BadRequestException('El tipo real, MIME o extensión del archivo no son válidos.');
    const affiliation = await this.prisma.arlAffiliation.findUnique({ where: { id: affiliationId } });
    if (!affiliation) throw new NotFoundException('Afiliación ARL no encontrada.');
    const actorUserId = request.principal?.kind === 'USER' ? request.principal.userId : undefined;
    const stored = await this.storage.putObject({
      objectKey: `arl/${affiliationId}/${randomUUID()}`,
      body: upload.buffer,
      mimeType,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const file = await tx.fileObject.create({
          data: {
            storageProvider: stored.storageProvider,
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            originalName: upload.originalname.slice(0, 255),
            mimeType,
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            createdById: actorUserId,
          },
        });
        const document = await tx.arlDocument.create({ data: { affiliationId, fileId: file.id } });
        await tx.auditEvent.create({
          data: {
            actorUserId,
            action: 'UPLOAD_ARL_DOCUMENT',
            entityType: 'ARL_AFFILIATION',
            entityId: affiliationId,
            evidenceFileId: file.id,
            afterJson: { documentId: document.id, sha256: file.sha256 },
            ip: request.ip,
            userAgent: request.header('user-agent'),
            correlationId: request.correlationId ?? 'unknown',
          },
        });
        return { id: document.id, fileId: file.id, sha256: file.sha256 };
      });
    } catch (error) {
      await this.storage.deleteObject(stored.objectKey);
      throw error;
    }
  }

  async getExpiringDays(): Promise<number> {
    // Regla operativa definida: la alerta inicia exactamente cinco días antes
    // del vencimiento, incluido el día en que vence.
    return 5;
  }

  private serialize(affiliation: ArlAffiliation & { documents?: unknown[] }, expiringDays: number) {
    return { ...affiliation, arlStatus: calculateArlStatus(affiliation.startDate, affiliation.endDate, expiringDays) };
  }
  private auditShape(affiliation: ArlAffiliation) {
    return {
      collaboratorId: affiliation.collaboratorId,
      providerName: affiliation.providerName,
      startDate: affiliation.startDate.toISOString().slice(0, 10),
      endDate: affiliation.endDate.toISOString().slice(0, 10),
    };
  }
  private parseDate(value: string): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('La fecha debe tener formato AAAA-MM-DD.');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
      throw new BadRequestException('Fecha inválida.');
    return parsed;
  }
  private validateDates(startDate: Date, endDate: Date): void {
    if (endDate < startDate)
      throw new BadRequestException('La fecha de finalización debe ser igual o posterior a la fecha de inicio.');
  }
  private detectMime(content: Buffer): 'application/pdf' | 'image/png' | 'image/jpeg' | null {
    if (content.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
    if (content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47) return 'image/png';
    if (content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return 'image/jpeg';
    return null;
  }
}
