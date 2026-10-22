import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { TemplateLoader } from '../pdf/template-loader';
import { TemplateRegistry } from '../pdf/template-registry';
import { CreateFormDto } from './dto/create-form.dto';
import { CreateFormVersionDto } from './dto/create-form-version.dto';
import {
  EDITABLE_FIELD_TYPES,
  isAutoFieldSource,
  isReservedNonAutomaticFieldId,
  isReservedSystemFieldId,
} from './form-schema-policy';
import { compatibilidadConPdf, vinculosDelPdf, type CampoEsquema, type Compatibilidad } from './pdf-compatibility';

type FormSchema = {
  title?: string;
  fields?: Array<{
    id?: unknown;
    type?: unknown;
    label?: unknown;
    required?: unknown;
    options?: unknown;
    order?: unknown;
    source?: unknown;
    section?: unknown;
    maxLength?: unknown;
  }>;
};

const MAX_FIELDS = 300;

@Injectable()
export class FormsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly templateRegistry: TemplateRegistry,
    private readonly templateLoader: TemplateLoader,
  ) {}
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

  /** Formatos con su historial de versiones, para el editor de Administración. */
  async list() {
    const forms = await this.prisma.form.findMany({
      include: {
        versions: {
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true,
            versionNumber: true,
            active: true,
            publishedAt: true,
            changeReason: true,
            createdAt: true,
            _count: { select: { submissions: true } },
          },
        },
      },
      orderBy: { code: 'asc' },
    });
    return forms.map(({ versions, ...form }) => ({
      ...form,
      versions: versions.map(({ _count, ...version }) => ({ ...version, submissions: _count.submissions })),
    }));
  }

  async getVersion(formId: string, versionId: string) {
    const version = await this.prisma.formVersion.findFirst({ where: { id: versionId, formId } });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    return version;
  }

  /** Revisa un esquema sin guardarlo: errores que impiden publicarlo y advertencias. */
  async checkVersion(formId: string, schemaJson: object): Promise<Compatibilidad> {
    this.validateSchema(schemaJson);
    const form = await this.prisma.form.findUnique({ where: { id: formId }, include: { currentVersion: true } });
    if (!form) throw new NotFoundException('Formulario no encontrado.');
    return this.compatibilidad(form.code, form.currentVersion?.schemaJson, schemaJson);
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

  /**
   * Guarda un borrador: una versión nueva sin publicar. Las versiones nunca se
   * editan; corregir un borrador es guardar otra versión.
   */
  async createVersion(formId: string, dto: CreateFormVersionDto, request: AuthenticatedRequest) {
    const actorUserId = this.actor(request);
    const revision = await this.checkVersion(formId, dto.schemaJson);
    this.exigirCompatible(revision);
    const changeReason = dto.changeReason.trim();
    if (!changeReason) throw new BadRequestException('Indica el motivo del cambio.');
    const version = await this.prisma.$transaction(async (tx) => {
      // El número se calcula dentro de la transacción; la unicidad (formId, versionNumber)
      // rechaza dos borradores simultáneos con el mismo número.
      const ultima = await tx.formVersion.findFirst({
        where: { formId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const versionNumber = (ultima?.versionNumber ?? 0) + 1;
      const creada = await tx.formVersion.create({
        data: {
          formId,
          versionNumber,
          schemaJson: dto.schemaJson as Prisma.InputJsonValue,
          createdById: actorUserId,
          changeReason,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorUserId,
          action: 'CREATE_FORM_VERSION',
          entityType: 'FORM_VERSION',
          entityId: creada.id,
          afterJson: { formId, versionNumber, warnings: revision.warnings.length },
          reason: changeReason,
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return creada;
    });
    return { ...version, warnings: revision.warnings };
  }

  async publish(formId: string, versionId: string, request: AuthenticatedRequest) {
    const actorUserId = this.actor(request);
    const version = await this.prisma.formVersion.findFirst({
      where: { id: versionId, formId },
      include: { form: { include: { currentVersion: true } } },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    // Se revisa otra vez contra lo publicado hoy: el borrador pudo crearse
    // cuando había otra versión vigente.
    this.exigirCompatible(
      await this.compatibilidad(version.form.code, version.form.currentVersion?.schemaJson, version.schemaJson),
    );
    const anterior = version.form.currentVersion?.versionNumber ?? null;
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
          beforeJson: { versionNumber: anterior },
          afterJson: { formId, versionNumber: published.versionNumber },
          ip: request.ip,
          userAgent: request.header('user-agent'),
          correlationId: request.correlationId ?? 'unknown',
        },
      });
      return form;
    });
  }

  private async compatibilidad(formCode: string, actual: unknown, nuevo: unknown): Promise<Compatibilidad> {
    const version = this.templateRegistry.defaultVersion(formCode);
    // Sin plantilla PDF no hay documento que pueda quedar incompleto.
    if (!version) return { errors: [], warnings: [] };
    const { mappingPath } = await this.templateRegistry.resolve(formCode, version);
    const vinculos = vinculosDelPdf(await this.templateLoader.loadMapping(mappingPath));
    return compatibilidadConPdf(this.campos(actual), this.campos(nuevo), vinculos);
  }

  private exigirCompatible(revision: Compatibilidad): void {
    if (revision.errors.length) {
      throw new BadRequestException({ message: revision.errors, warnings: revision.warnings });
    }
  }

  private campos(schema: unknown): CampoEsquema[] {
    const fields = (schema as FormSchema | null)?.fields;
    return Array.isArray(fields)
      ? fields.filter((field): field is CampoEsquema => typeof field?.id === 'string' && typeof field.type === 'string')
      : [];
  }

  private actor(request: AuthenticatedRequest): string {
    if (request.principal?.kind !== 'USER') throw new BadRequestException('Actor administrativo requerido.');
    return request.principal.userId;
  }
  private validateSchema(schema: object): void {
    const value = schema as FormSchema;
    if (!Array.isArray(value.fields) || value.fields.length === 0)
      throw new BadRequestException('El esquema debe incluir campos.');
    if (value.fields.length > MAX_FIELDS)
      throw new BadRequestException(`El esquema admite hasta ${MAX_FIELDS} campos.`);
    const ids = new Set<string>();
    for (const field of value.fields) {
      if (typeof field.id !== 'string' || !/^[a-z][a-z0-9_]{1,80}$/.test(field.id) || ids.has(field.id))
        throw new BadRequestException('Cada campo requiere un id estable y único.');
      const isAuto = field.type === 'auto';
      if (
        typeof field.label !== 'string' ||
        !field.label.trim() ||
        field.label.length > 500 ||
        (!isAuto && !EDITABLE_FIELD_TYPES.has(String(field.type))) ||
        typeof field.required !== 'boolean' ||
        !Number.isInteger(field.order) ||
        (field.section !== undefined && (typeof field.section !== 'string' || field.section.length > 200)) ||
        (field.maxLength !== undefined &&
          (typeof field.maxLength !== 'number' || !Number.isInteger(field.maxLength) || field.maxLength < 1))
      )
        throw new BadRequestException(`Definición inválida del campo ${field.id}.`);
      if (isAuto && (!isAutoFieldSource(field.source) || isReservedNonAutomaticFieldId(field.id))) {
        throw new BadRequestException(`El campo automático ${field.id} tiene una fuente o identificador inválido.`);
      }
      if (!isAuto && isReservedSystemFieldId(field.id)) {
        throw new BadRequestException(`El identificador ${field.id} está reservado para datos del sistema.`);
      }
      if (field.type === 'select' || field.type === 'multi_select') {
        const options = field.options;
        if (!Array.isArray(options) || options.length === 0)
          throw new BadRequestException(`El campo ${field.id} requiere opciones.`);
        const normalized = options.map((option) => (typeof option === 'string' ? option.trim() : ''));
        if (normalized.some((option) => !option || option.length > 300) || new Set(normalized).size !== options.length)
          throw new BadRequestException(`Las opciones del campo ${field.id} deben ser textos únicos y no vacíos.`);
      }
      ids.add(field.id);
    }
  }
}
