import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { calculateArlStatus } from '../arl/arl-status';
import { ArlService } from '../arl/arl.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { randomUUID } from 'node:crypto';
import { SubmitFormDto } from './dto/submit-form.dto';

type Field = { id?: unknown; type?: unknown; required?: unknown; options?: unknown };
@Injectable()
export class SubmissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly arl: ArlService,
    private readonly storage: StorageService,
  ) {}
  async workflow(request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    const collaborator = await this.prisma.collaborator.findUnique({
      where: { id: collaboratorId },
      include: { arlAffiliations: { orderBy: { endDate: 'desc' }, take: 1 } },
    });
    if (!collaborator) throw new NotFoundException();
    const affiliation = collaborator.arlAffiliations[0];
    const days = await this.arl.getExpiringDays();
    const arlStatus = affiliation ? calculateArlStatus(affiliation.startDate, affiliation.endDate, days) : 'VENCIDA';
    return {
      collaborator: {
        firstName: collaborator.firstName,
        lastName: collaborator.lastName,
        documentNumber: collaborator.documentNumber,
      },
      arl: affiliation
        ? {
            providerName: affiliation.providerName,
            startDate: affiliation.startDate,
            endDate: affiliation.endDate,
            status: arlStatus,
          }
        : { status: 'VENCIDA' },
      canContinue: arlStatus !== 'VENCIDA',
    };
  }
  async submit(formCode: string, dto: SubmitFormDto, request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    const flow = await this.workflow(request);
    if (!flow.canContinue)
      throw new ForbiddenException('La ARL está vencida o no vigente. No puede enviar el permiso.');
    const form = await this.prisma.form.findUnique({ where: { code: formCode }, include: { currentVersion: true } });
    if (!form?.currentVersion || form.status !== 'PUBLISHED' || !form.currentVersion.active)
      throw new NotFoundException('No hay un formulario vigente.');
    this.validateAnswers(form.currentVersion.schemaJson, dto.answers);
    const signature = this.signatureBuffer(dto.signatureDataUrl);
    const stored = await this.storage.putObject({
      objectKey: `signatures/${randomUUID()}.png`,
      body: signature,
      mimeType: 'image/png',
    });
    try {
      const submission = await this.prisma.$transaction(async (tx) => {
        const created = await tx.formSubmission.create({
          data: {
            collaboratorId,
            formVersionId: form.currentVersion!.id,
            status: 'PENDING_APPROVAL',
            answersJson: dto.answers as Prisma.InputJsonValue,
            safetyTalkConfirmed: true,
            safetyTalkConfirmedAt: new Date(),
            arlSnapshotJson: flow.arl as Prisma.InputJsonValue,
            submittedAt: new Date(),
          },
        });
        const file = await tx.fileObject.create({
          data: {
            storageProvider: stored.storageProvider,
            bucket: stored.bucket,
            objectKey: stored.objectKey.replace(/\\/g, '/'),
            originalName: 'firma.png',
            mimeType: 'image/png',
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            createdById: null,
          },
        });
        await tx.signature.create({
          data: {
            submissionId: created.id,
            fileId: file.id,
            sha256: stored.sha256,
            ip: request.ip,
            userAgent: request.header('user-agent'),
          },
        });
        await tx.auditEvent.create({
          data: {
            actorCollaboratorId: collaboratorId,
            action: 'SUBMIT_FORM',
            entityType: 'FORM_SUBMISSION',
            entityId: created.id,
            afterJson: {
              formCode: form.code,
              formVersion: form.currentVersion!.versionNumber,
              status: 'PENDING_APPROVAL',
            },
            ip: request.ip,
            userAgent: request.header('user-agent'),
            correlationId: request.correlationId ?? 'unknown',
          },
        });
        return created;
      });
      return { id: submission.id, status: submission.status, submittedAt: submission.submittedAt };
    } catch (error) {
      await this.storage.deleteObject(stored.objectKey);
      throw error;
    }
  }
  async latest(request: AuthenticatedRequest) {
    const collaboratorId = this.collaboratorId(request);
    return this.prisma.formSubmission.findFirst({
      where: { collaboratorId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        submittedAt: true,
        approval: { select: { decision: true, decidedAt: true, reason: true } },
      },
    });
  }
  private collaboratorId(request: AuthenticatedRequest): string {
    if (request.principal?.kind !== 'COLLABORATOR')
      throw new ForbiddenException('Esta operación solo está disponible para colaboradores.');
    return request.principal.collaboratorId;
  }
  private signatureBuffer(dataUrl: string): Buffer {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new BadRequestException('La firma debe ser una imagen PNG válida.');
    const content = Buffer.from(match[1], 'base64');
    if (content.length < 100 || content.length > 1_000_000 || content[0] !== 0x89 || content[1] !== 0x50)
      throw new BadRequestException('El archivo de firma no es válido o excede el tamaño permitido.');
    return content;
  }
  private validateAnswers(schema: Prisma.JsonValue, answers: object): void {
    const fields = (schema as { fields?: Field[] }).fields;
    if (!Array.isArray(fields)) throw new BadRequestException('El formulario publicado tiene un esquema inválido.');
    const source = answers as Record<string, unknown>;
    for (const field of fields) {
      if (typeof field.id !== 'string') continue;
      const value = source[field.id];
      if (
        field.required &&
        (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length))
      )
        throw new BadRequestException(`El campo ${field.id} es obligatorio.`);
      if (value === undefined || value === null || value === '') continue;
      if (field.type === 'select' && (!Array.isArray(field.options) || !field.options.includes(value as never)))
        throw new BadRequestException(`Opción no válida en ${field.id}.`);
      if (
        field.type === 'multi_select' &&
        (!Array.isArray(value) ||
          !Array.isArray(field.options) ||
          value.some((item) => !(field.options as unknown[]).includes(item)))
      )
        throw new BadRequestException(`Opciones no válidas en ${field.id}.`);
      if (field.type === 'yes_no' && value !== 'SI' && value !== 'NO')
        throw new BadRequestException(`Respuesta no válida en ${field.id}.`);
      if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
        throw new BadRequestException(`Número no válido en ${field.id}.`);
    }
  }
}
