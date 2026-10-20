import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { TemplateRegistry } from './template-registry';
import { TemplateLoader, type CheckboxField, type TemplateMapping } from './template-loader';
import { FieldRenderer, ResolvedSignature } from './field-renderer';
import { CrewMemberRow } from './renderers/crew-table.renderer';

/** Zona horaria operativa del permiso: la misma que usa `businessDay` para `workDate`. */
const BUSINESS_TIME_ZONE = 'America/Bogota';

const EDITABLE_SCHEMA_FIELD_TYPES = new Set(['text', 'textarea', 'yes_no', 'select', 'multi_select', 'number', 'date']);

const RESERVED_AUTOMATIC_FIELD_IDS = new Set([
  'vigencia_permiso',
  'fecha_trabajo',
  'hora_inicio',
  'hora_finalizacion',
  'hora_fin',
  'certificado_alturas',
  'seguridad_social_verificada',
]);

const RESERVED_SIGNATURE_FIELD_IDS = new Set([
  'autorizador_firma',
  'firma_autorizador',
  'responsable_emergencia_firma',
  'firma_responsable_emergencia',
  'coordinador_alturas_firma',
  'firma_coordinador_alturas',
]);

const RESERVED_IDENTITY_FIELD_IDS = new Set(['cedula', 'documento', 'nombre', 'cargo']);

const RESERVED_CREW_ROW_PATTERN = /^(cuadrilla|ejecutor)_\d+_/i;

const HISTORICAL_HSE_FO_016_EDITABLE_IDS = new Set([
  'empresa',
  'ciudad',
  'lugar_trabajo',
  'area_proceso',
  'ubicacion_trabajo',
  'tipos_trabajo_altura',
  'herramientas',
  'altura_metros',
  'peligros',
  'controles',
  'sistemas_acceso',
  'otras_tar_involucradas',
  'otras_tar',
  'otras_tar_detalle',
  'procedimiento',
  'epp_otros',
  'epp_otros_detalle',
  'observaciones',
  'autorizador_nombre_documento',
  'responsable_emergencia',
  'coordinador_alturas',
  ...Array.from({ length: 11 }, (_, i) => `epp_${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 28 }, (_, i) => `verificacion_${String(i + 1).padStart(2, '0')}`),
]);

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly templateRegistry: TemplateRegistry,
    private readonly templateLoader: TemplateLoader,
    private readonly fieldRenderer: FieldRenderer,
  ) {}
  async generateFinalPdf(submissionId: string, actorUserId: string): Promise<string> {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: {
        collaborator: true,
        formVersion: { include: { form: true } },
        members: {
          include: {
            collaborator: true,
            jobPosition: true,
            signature: { include: { file: true } },
          },
          orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
        },
        approval: { include: { decidedBy: true } },
        finalPdfFile: true,
      },
    });
    if (!submission) throw new NotFoundException('Envío no encontrado.');
    if (submission.finalPdfFile) return submission.finalPdfFile.id;
    if (!submission.approval) throw new Error('El envío debe estar decidido antes de generar PDF.');
    if (!submission.members.length) throw new Error('El permiso no tiene integrantes registrados.');

    const formCode = submission.formVersion.form.code;
    const defaultVer = this.templateRegistry.defaultVersion(formCode) ?? 'v00';
    const templateVersion = (submission as { templateVersion?: string | null }).templateVersion || defaultVer;

    // 1. Resolver y cargar la plantilla base inmutable
    let templateLocations: { templatePath: string; mappingPath: string };
    try {
      templateLocations = await this.templateRegistry.resolve(formCode, templateVersion);
    } catch {
      templateLocations = await this.templateRegistry.resolve(formCode, defaultVer);
    }
    const { templatePath, mappingPath } = templateLocations;
    const { pdfDoc, mapping } = await this.templateLoader.load(templatePath, mappingPath);

    // 2. Preparar respuestas base permitiendo únicamente campos editables verificados
    const rawAnswers =
      submission.answersJson && typeof submission.answersJson === 'object' && !Array.isArray(submission.answersJson)
        ? (submission.answersJson as Record<string, unknown>)
        : {};
    const allowedEditableFieldIds = this.resolveAllowedEditableFieldIds(
      submission.formVersion?.schemaJson,
      mapping,
      formCode,
    );

    const answers: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawAnswers)) {
      if (this.isProtectedAnswerKey(key, mapping)) continue;
      if (!allowedEditableFieldIds.has(key)) continue;
      if (!this.isSafeEditableAnswerValue(value)) continue;
      answers[key] = value;
    }

    // Fechas y horas calculadas exclusivamente desde fuentes autorizadas de FormSubmission.
    // AUD-003: nunca se usa la zona horaria del proceso. `workDate` es un DATE de
    // PostgreSQL (medianoche UTC) y se lee en UTC; los instantes se muestran en Colombia.
    const formattedDate = submission.workDate
      ? this.formatDate(submission.workDate, 'UTC')
      : submission.submittedAt
        ? this.formatDate(submission.submittedAt, BUSINESS_TIME_ZONE)
        : undefined;
    if (formattedDate) {
      answers.fecha_trabajo = formattedDate;
      answers.vigencia_permiso = formattedDate;
    }
    if (submission.startedAt) {
      answers.hora_inicio = this.formatTime(submission.startedAt);
    }
    if (submission.closedAt) {
      const formattedCloseTime = this.formatTime(submission.closedAt);
      answers.hora_fin = formattedCloseTime;
      answers.hora_finalizacion = formattedCloseTime;
    }

    // 3. Procesar cuadrilla y firmas exclusivamente desde registros de base de datos.
    // TEC-008: un integrante sin fila en la plantilla desaparecería del documento sin aviso.
    const crewCapacity = this.crewCapacity(mapping);
    if (submission.members.length > crewCapacity) {
      throw new Error(
        `El permiso ${submission.id} tiene ${submission.members.length} integrantes y la plantilla ${formCode}/${templateVersion} solo admite ${crewCapacity}.`,
      );
    }
    const signatures: ResolvedSignature[] = [];
    const crewMembers: CrewMemberRow[] = [];

    for (let i = 0; i < submission.members.length; i++) {
      const member = submission.members[i];
      const idx = String(i + 1).padStart(2, '0');
      const nombre = `${member.collaborator.firstName} ${member.collaborator.lastName}`.trim();
      const cedula = member.collaborator.documentNumber;
      const cargo = member.jobPosition?.name ?? member.collaborator.jobTitle ?? '—';
      // AUD-002: los estados salen de la evidencia guardada al enviar el permiso
      // (member.complianceJson), nunca de answersJson ni de valores por defecto.
      const { certificado, segSocial } = this.complianceTexts(member.complianceJson);

      // Mapeo declarativo fila por fila (cuadrilla_01..05 y alias ejecutor_01..05)
      answers[`cuadrilla_${idx}_cedula`] = cedula;
      answers[`cuadrilla_${idx}_nombre`] = nombre;
      answers[`cuadrilla_${idx}_certificado`] = certificado;
      answers[`cuadrilla_${idx}_cargo`] = cargo;
      answers[`cuadrilla_${idx}_seg_social`] = segSocial;

      answers[`ejecutor_${idx}_cedula`] = cedula;
      answers[`ejecutor_${idx}_nombre`] = nombre;
      answers[`ejecutor_${idx}_certificado`] = certificado;
      answers[`ejecutor_${idx}_cargo`] = cargo;
      answers[`ejecutor_${idx}_seg_social`] = segSocial;

      // Recuperar firma de storage si existe
      let signatureBytes: Buffer | undefined;
      if (member.signature?.file?.objectKey) {
        try {
          signatureBytes = await this.storage.getObject(member.signature.file.objectKey);
          signatures.push({
            memberIndex: i,
            imageBytes: signatureBytes,
          });
        } catch (error) {
          this.logger.warn(`No se pudo cargar la firma del integrante ${nombre}: ${String(error)}`);
        }
      }

      crewMembers.push({
        cedula,
        nombre,
        certificado,
        cargo,
        seguridadSocial: segSocial,
        signatureBytes,
      });
    }

    // 4. Superponer información sobre la plantilla oficial inmutable
    await this.fieldRenderer.render(pdfDoc, mapping, {
      answers,
      signatures,
      members: crewMembers,
    });

    // 5. Guardar documento resultante
    const pdfBytes = await pdfDoc.save();
    const stored = await this.storage.putObject({
      objectKey: `pdf/${submission.id}-${randomUUID()}.pdf`,
      body: Buffer.from(pdfBytes),
      mimeType: 'application/pdf',
    });

    // 6. Transacción para vincular archivo y auditoría
    try {
      const file = await this.prisma.$transaction(async (tx) => {
        const created = await tx.fileObject.create({
          data: {
            storageProvider: stored.storageProvider,
            bucket: stored.bucket,
            objectKey: stored.objectKey,
            originalName: `permiso-${submission.formVersion.form.code}-${submission.id}.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: stored.sizeBytes,
            sha256: stored.sha256,
            createdById: actorUserId,
          },
        });
        await tx.formSubmission.update({ where: { id: submission.id }, data: { finalPdfFileId: created.id } });
        await tx.auditEvent.create({
          data: {
            actorUserId,
            action: 'GENERATE_FINAL_PDF',
            entityType: 'FORM_SUBMISSION',
            entityId: submission.id,
            afterJson: { fileId: created.id, sha256: stored.sha256 },
            correlationId: `pdf-${submission.id}`,
          },
        });
        return created;
      });
      return file.id;
    } catch (error) {
      await this.storage.deleteObject(stored.objectKey);
      throw error;
    }
  }

  /** Filas de integrante que la plantilla puede firmar: una por `memberIndex` distinto. */
  private crewCapacity(mapping: TemplateMapping): number {
    const indexes = new Set<number>();
    for (const field of Object.values(mapping.fields ?? {})) {
      if (field.type === 'SIGNATURE' && typeof field.memberIndex === 'number') indexes.add(field.memberIndex);
    }
    return indexes.size;
  }

  private complianceTexts(complianceJson: unknown): { certificado: string; segSocial: string } {
    const evidence =
      complianceJson && typeof complianceJson === 'object' && !Array.isArray(complianceJson)
        ? (complianceJson as { alturas?: { estado?: unknown }; seguridadSocial?: { estado?: unknown } })
        : {};
    return {
      certificado: this.complianceStatusText(evidence.alturas?.estado),
      segSocial: this.complianceStatusText(evidence.seguridadSocial?.estado),
    };
  }

  /** Texto corto para celdas de ~60 pt; un estado desconocido no se presenta como vigente. */
  private complianceStatusText(estado: unknown): string {
    switch (estado) {
      case 'VIGENTE':
        return 'Vigente';
      case 'PROXIMA_A_VENCER':
        return 'Vigente (por vencer)';
      case 'VENCIDA':
        return 'No vigente';
      case 'NO_APLICA':
        return 'No aplica';
      default:
        return 'Sin registro';
    }
  }

  private formatDate(value: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone }).format(
      value,
    );
  }

  private formatTime(value: Date): string {
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: BUSINESS_TIME_ZONE,
    })
      .format(value)
      .replace(/\s*([ap])\.\s*m\./i, ' $1.m.');
  }

  private resolveAllowedEditableFieldIds(schemaJson: unknown, mapping: TemplateMapping, formCode: string): Set<string> {
    const templateEditableIds = this.extractTemplateEditableFieldIds(mapping, formCode);
    const schemaFields = (schemaJson as { fields?: unknown } | null)?.fields;
    if (!Array.isArray(schemaFields) || schemaFields.length === 0) {
      this.logger.warn(
        `Esquema inválido o vacío para el formulario ${formCode}; aplicando lista blanca estricta de campos editables de la plantilla.`,
      );
      return templateEditableIds;
    }

    const validSchemaEditableIds = new Set<string>();
    const nonEditableOrInvalidIds = new Set<string>();
    let hasInvalidFieldEntries = false;

    for (const rawField of schemaFields) {
      if (!rawField || typeof rawField !== 'object') {
        hasInvalidFieldEntries = true;
        continue;
      }
      const field = rawField as { id?: unknown; type?: unknown };
      if (typeof field.id !== 'string' || !field.id.trim()) {
        hasInvalidFieldEntries = true;
        continue;
      }
      if (typeof field.type !== 'string') {
        hasInvalidFieldEntries = true;
        nonEditableOrInvalidIds.add(field.id);
        continue;
      }
      if (field.type === 'auto') {
        nonEditableOrInvalidIds.add(field.id);
        continue;
      }
      if (!EDITABLE_SCHEMA_FIELD_TYPES.has(field.type) || this.isProtectedAnswerKey(field.id, mapping)) {
        hasInvalidFieldEntries = true;
        nonEditableOrInvalidIds.add(field.id);
        continue;
      }
      validSchemaEditableIds.add(field.id);
    }

    if (hasInvalidFieldEntries || validSchemaEditableIds.size === 0) {
      this.logger.warn(
        `Esquema incompleto o con entradas inválidas para ${formCode}; aplicando compatibilidad controlada con campos editables de la plantilla.`,
      );
    }

    const combined = new Set<string>(validSchemaEditableIds);
    for (const id of templateEditableIds) {
      if (!nonEditableOrInvalidIds.has(id)) {
        combined.add(id);
      }
    }
    return combined;
  }

  private extractTemplateEditableFieldIds(mapping: TemplateMapping, formCode: string): Set<string> {
    const editableIds = new Set<string>();
    if (formCode === 'HSE-FO-016') {
      for (const id of HISTORICAL_HSE_FO_016_EDITABLE_IDS) {
        editableIds.add(id);
      }
    }
    for (const [key, field] of Object.entries(mapping.fields ?? {})) {
      if (
        (field.type === 'TEXT' || field.type === 'MULTILINE_TEXT' || field.type === 'NUMBER') &&
        !this.isProtectedAnswerKey(key, mapping)
      ) {
        editableIds.add(key);
      } else if (field.type === 'CHECKBOX') {
        const target = (field as CheckboxField).checkedWhen?.field;
        if (typeof target === 'string' && !this.isProtectedAnswerKey(target, mapping)) {
          editableIds.add(target);
        }
      }
    }
    return editableIds;
  }

  private isSafeEditableAnswerValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') {
      return value.length <= 2000 && !/^data:image\//i.test(value.trim());
    }
    if (typeof value === 'number') {
      return Number.isFinite(value);
    }
    if (typeof value === 'boolean') {
      return true;
    }
    if (Array.isArray(value)) {
      return (
        value.length <= 50 &&
        value.every((item) => typeof item === 'string' && item.length <= 500 && !/^data:image\//i.test(item.trim()))
      );
    }
    return false;
  }

  private isProtectedAnswerKey(key: string, mapping?: TemplateMapping): boolean {
    if (
      RESERVED_AUTOMATIC_FIELD_IDS.has(key) ||
      RESERVED_SIGNATURE_FIELD_IDS.has(key) ||
      RESERVED_IDENTITY_FIELD_IDS.has(key) ||
      RESERVED_CREW_ROW_PATTERN.test(key)
    ) {
      return true;
    }
    const mappedField = mapping?.fields?.[key];
    if (
      mappedField &&
      (mappedField.type === 'SIGNATURE' ||
        mappedField.type === 'IMAGE' ||
        mappedField.type === 'CREW_TABLE' ||
        mappedField.type === 'DATE' ||
        mappedField.type === 'TIME')
    ) {
      return true;
    }
    return false;
  }
}
