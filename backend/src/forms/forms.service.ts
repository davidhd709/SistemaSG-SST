import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';

const types = new Set(['text', 'textarea', 'yes_no', 'select', 'multi_select', 'number', 'date']);
type FormSchema = {
  title?: string;
  fields?: Array<{
    id?: unknown;
    type?: unknown;
    label?: unknown;
    required?: unknown;
    options?: unknown;
    order?: unknown;
  }>;
};

@Injectable()
export class FormsService {
  constructor(private readonly prisma: PrismaService) {}
  async getCurrent(code: string) {
    const form = await this.prisma.form.findUnique({ where: { code }, include: { currentVersion: true } });
    if (!form?.currentVersion || form.status !== 'PUBLISHED' || !form.currentVersion.active)
      throw new NotFoundException('No hay una versión publicada de este formulario.');
    return {
      code: form.code,
      name: form.name,
      description: form.description,
      versionNumber: form.currentVersion.versionNumber,
      schemaJson: form.currentVersion.schemaJson,
    };
  }
  async create(dto: CreateFormDto, request: AuthenticatedRequest) {
    this.validateSchema(dto.schemaJson);
    const actorUserId = this.actor(request);
    if (await this.prisma.form.findUnique({ where: { code: dto.code } }))
      throw new ConflictException('El código de formulario ya existe.');
    return this.prisma.$transaction(async (tx) => {
      const form = await tx.form.create({
        data: { code: dto.code.trim().toUpperCase(), name: dto.name.trim(), description: dto.description?.trim() },
      });
      const version = await tx.formVersion.create({
        data: {
          formId: form.id,
          versionNumber: 1,
          schemaJson: dto.schemaJson as Prisma.InputJsonValue,
          createdById: actorUserId,
          changeReason: dto.changeReason.trim(),
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_FORM',
          entityType: 'FORM',
          entityId: form.id,
          afterJson: { code: form.code, version: 1 },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return { form, version };
    });
  }
  async createVersion(formId: string, dto: CreateFormVersionDto, request: AuthenticatedRequest) {
    this.validateSchema(dto.schemaJson);
    const actorUserId = this.actor(request);
    const form = await this.prisma.form.findUnique({
      where: { id: formId },
      include: { versions: { orderBy: { versionNumber: 'desc' }, take: 1 } },
    });
    if (!form) throw new NotFoundException('Formulario no encontrado.');
    const versionNumber = (form.versions[0]?.versionNumber ?? 0) + 1;
    const version = await this.prisma.formVersion.create({
      data: {
        formId,
        versionNumber,
        schemaJson: dto.schemaJson as Prisma.InputJsonValue,
        createdById: actorUserId,
        changeReason: dto.changeReason.trim(),
      },
    });
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action: 'CREATE_FORM_VERSION',
        entityType: 'FORM_VERSION',
        entityId: version.id,
        afterJson: { formId, versionNumber },
        ip: request.ip,
        userAgent: request.header('user-agent'),
        correlationId: request.correlationId ?? 'unknown',
      },
    });
    return version;
  }
  async publish(formId: string, versionId: string, request: AuthenticatedRequest) {
    const actorUserId = this.actor(request);
    const version = await this.prisma.formVersion.findFirst({ where: { id: versionId, formId } });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    return this.prisma.$transaction(async (tx) => {
      await tx.formVersion.updateMany({ where: { formId }, data: { active: false } });
      const published = await tx.formVersion.update({
        where: { id: versionId },
        data: { active: true, publishedAt: new Date() },
      });
      const form = await tx.form.update({
        where: { id: formId },
        data: { status: 'PUBLISHED', currentVersionId: versionId },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'PUBLISH_FORM_VERSION',
          entityType: 'FORM_VERSION',
          entityId: versionId,
          afterJson: { formId, versionNumber: published.versionNumber },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return form;
    });
  }
  private actor(request: AuthenticatedRequest): string {
    if (request.principal?.kind !== 'USER') throw new BadRequestException('Actor administrativo requerido.');
    return request.principal.userId;
  }
  private validateSchema(schema: object): void {
    const value = schema as FormSchema;
    if (!Array.isArray(value.fields) || value.fields.length === 0)
      throw new BadRequestException('El esquema debe incluir campos.');
    const ids = new Set<string>();
    for (const field of value.fields) {
      if (typeof field.id !== 'string' || !/^[a-z][a-z0-9_]{1,80}$/.test(field.id) || ids.has(field.id))
        throw new BadRequestException('Cada campo requiere un id estable y único.');
      if (
        typeof field.label !== 'string' ||
        !field.label.trim() ||
        !types.has(String(field.type)) ||
        typeof field.required !== 'boolean' ||
        !Number.isInteger(field.order)
      )
        throw new BadRequestException(`Definición inválida del campo ${field.id}.`);
      if (
        (field.type === 'select' || field.type === 'multi_select') &&
        (!Array.isArray(field.options) || field.options.length === 0)
      )
        throw new BadRequestException(`El campo ${field.id} requiere opciones.`);
      ids.add(field.id);
    }
  }
}
