import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { TemplateRegistry } from './template-registry';
import { TemplateLoader, type CheckboxField, type TemplateMapping } from './template-loader';
import { FieldRenderer, ResolvedSignature } from './field-renderer';
import { CrewMemberRow } from './renderers/crew-table.renderer';
import { PDFDocument, type PDFFont, StandardFonts, rgb } from 'pdf-lib';

export type PdfGenerationActor = { kind: 'USER' | 'COLLABORATOR'; id: string };

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
  async generateFinalPdf(submissionId: string, generationActor: PdfGenerationActor): Promise<string> {
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
        approval: true,
        closedBy: true,
        closedByUser: { select: { email: true } },
        finalPdfFile: true,
      },
    });
    if (!submission) throw new NotFoundException('Envío no encontrado.');
    if (submission.finalPdfFile) return submission.finalPdfFile.id;
    if (!submission.approval) throw new Error('El envío debe estar decidido antes de generar PDF.');
    if (!submission.members.length) throw new Error('El permiso no tiene integrantes registrados.');

    const formCode = submission.formVersion.form.code;
    const templateVersion = submission.templateVersion ?? this.templateRegistry.defaultVersion(formCode);
    if (!templateVersion) throw new NotFoundException(`No hay plantilla PDF vigente para ${formCode}.`);

    // 1. Resolver y cargar la plantilla base inmutable
    const { templatePath, mappingPath } = await this.templateRegistry.resolve(formCode, templateVersion);
    const { pdfDoc, mapping } = await this.templateLoader.load(templatePath, mappingPath);
    if (mapping.meta.formCode !== formCode || mapping.meta.templateVersion !== templateVersion) {
      throw new Error(`El mapping no corresponde a la plantilla ${formCode}/${templateVersion}.`);
    }

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

      // Una firma ausente o ilegible invalida el documento completo.
      const signatureKey = member.signature?.file?.objectKey;
      if (!signatureKey) {
        this.logger.error(`Falta la firma del integrante ${member.id} en el permiso ${submission.id}.`);
        throw new Error(`Falta la firma del integrante ${member.id}.`);
      }
      let signatureBytes: Buffer;
      try {
        signatureBytes = await this.storage.getObject(signatureKey);
      } catch (error) {
        this.logger.error(`No se pudo cargar la firma del integrante ${member.id}: ${String(error)}`);
        throw new Error(`No se pudo cargar la firma del integrante ${member.id}.`, { cause: error });
      }
      if (!signatureBytes.length) {
        this.logger.error(`La firma del integrante ${member.id} está vacía.`);
        throw new Error(`La firma del integrante ${member.id} está vacía.`);
      }
      signatures.push({ memberIndex: i, imageBytes: signatureBytes });

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

    // La plantilla oficial no tiene un espacio para novedades de cierre. Se
    // agrega un anexo al mismo documento para conservar actor, momento y notas.
    await this.appendClosureRecord(pdfDoc, submission);

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
            createdById: generationActor.kind === 'USER' ? generationActor.id : null,
          },
        });
        await tx.formSubmission.update({
          where: { id: submission.id },
          data: { finalPdfFileId: created.id, templateVersion },
        });
        await tx.auditEvent.create({
          data: {
            ...(generationActor.kind === 'USER'
              ? { actorUserId: generationActor.id }
              : { actorCollaboratorId: generationActor.id }),
            action: 'GENERATE_FINAL_PDF',
            entityType: 'FORM_SUBMISSION',
            entityId: submission.id,
            afterJson: { fileId: created.id, sha256: stored.sha256, templateVersion },
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

  private async appendClosureRecord(
    pdfDoc: PDFDocument,
    submission: {
      id: string;
      closedAt: Date | null;
      closureNotes?: string | null;
      closedBy?: { firstName: string; lastName: string; documentNumber: string } | null;
      closedByUser?: { email: string } | null;
    },
  ): Promise<void> {
    if (!submission.closedAt || (!submission.closedBy && !submission.closedByUser && !submission.closureNotes)) return;

    const page = pdfDoc.addPage([612, 792]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const dark = rgb(0.12, 0.18, 0.17);
    const muted = rgb(0.35, 0.4, 0.39);
    const closer = submission.closedBy
      ? `${submission.closedBy.firstName} ${submission.closedBy.lastName} - ${submission.closedBy.documentNumber}`
      : (submission.closedByUser?.email ?? 'No registrado');
    const closureType = submission.closedByUser ? 'Cierre administrativo' : 'Cierre por integrante de la cuadrilla';
    const closedAt = `${this.formatDate(submission.closedAt, BUSINESS_TIME_ZONE)} ${this.formatTime(submission.closedAt)}`;
    const notes = submission.closureNotes?.trim() || 'Sin novedades registradas.';

    page.drawText('REGISTRO DE CIERRE DEL PERMISO', { x: 54, y: 720, size: 16, font: bold, color: dark });
    page.drawText('Anexo de trazabilidad del documento final', { x: 54, y: 698, size: 9, font, color: muted });
    page.drawLine({ start: { x: 54, y: 684 }, end: { x: 558, y: 684 }, thickness: 1, color: dark });

    this.drawClosureDatum(page, bold, font, 'Tipo de cierre', closureType, 650);
    this.drawClosureDatum(page, bold, font, 'Cerrado por', closer, 612);
    this.drawClosureDatum(page, bold, font, 'Fecha y hora', closedAt, 574);

    page.drawText('Novedades de la jornada', { x: 54, y: 520, size: 10, font: bold, color: dark });
    let y = 498;
    for (const line of this.wrapPdfText(notes, font, 10, 504)) {
      page.drawText(line, { x: 54, y, size: 10, font, color: dark });
      y -= 15;
    }

    page.drawLine({ start: { x: 54, y: 78 }, end: { x: 558, y: 78 }, thickness: 0.5, color: muted });
    page.drawText(`Permiso: ${submission.id}`, { x: 54, y: 60, size: 8, font, color: muted });
  }

  private drawClosureDatum(
    page: ReturnType<PDFDocument['addPage']>,
    bold: PDFFont,
    font: PDFFont,
    label: string,
    value: string,
    y: number,
  ): void {
    page.drawText(label, { x: 54, y, size: 9, font: bold, color: rgb(0.12, 0.18, 0.17) });
    page.drawText(value, { x: 170, y, size: 9, font, color: rgb(0.12, 0.18, 0.17) });
  }

  private wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
      let line = '';
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line.trimEnd());
          line = character.trimStart();
        } else {
          line = candidate;
        }
      }
      lines.push(line || ' ');
    }
    return lines;
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
