import { randomUUID } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { TemplateRegistry } from './template-registry';
import { TemplateLoader } from './template-loader';
import { FieldRenderer, ResolvedSignature } from './field-renderer';
import { CrewMemberRow } from './renderers/crew-table.renderer';

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
    const templateVersion = `v${String(submission.formVersion.versionNumber).padStart(2, '0')}`;

    // 1. Resolver y cargar la plantilla base inmutable
    const { templatePath, mappingPath } = await this.templateRegistry.resolve(formCode, templateVersion);
    const { pdfDoc, mapping } = await this.templateLoader.load(templatePath, mappingPath);

    // 2. Preparar respuestas base
    const answers: Record<string, unknown> = {
      ...((submission.answersJson as Record<string, unknown>) || {}),
    };

    // Fechas y horas si no vienen directamente en answers
    if (!answers.fecha_trabajo && (submission.workDate || submission.submittedAt)) {
      const d = submission.workDate ?? submission.submittedAt;
      answers.fecha_trabajo = d
        ? new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
        : '';
    }
    if (!answers.hora_inicio && submission.startedAt) {
      answers.hora_inicio = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }).format(submission.startedAt);
    }
    if (!answers.hora_fin && submission.closedAt) {
      answers.hora_fin = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true }).format(submission.closedAt);
    }

    // 3. Procesar cuadrilla y firmas
    const signatures: ResolvedSignature[] = [];
    const crewMembers: CrewMemberRow[] = [];

    for (let i = 0; i < submission.members.length; i++) {
      const member = submission.members[i];
      const idx = String(i + 1).padStart(2, '0');
      const nombre = `${member.collaborator.firstName} ${member.collaborator.lastName}`.trim();
      const cedula = member.collaborator.documentNumber;
      const cargo = member.jobPosition?.name ?? member.collaborator.jobTitle ?? '—';
      const certificado =
        (answers[`cuadrilla_${idx}_certificado`] as string) ||
        (member.isLead ? (answers['certificado_alturas'] as string) || 'Vigente' : 'Vigente');
      const segSocial =
        (answers[`cuadrilla_${idx}_seg_social`] as string) ||
        (member.isLead ? (answers['seguridad_social_verificada'] as string) || 'Verificada' : 'Verificada');

      // Mapeo declarativo fila por fila (cuadrilla_01..05 y alias ejecutor_01..05)
      answers[`cuadrilla_${idx}_cedula`] = answers[`cuadrilla_${idx}_cedula`] || cedula;
      answers[`cuadrilla_${idx}_nombre`] = answers[`cuadrilla_${idx}_nombre`] || nombre;
      answers[`cuadrilla_${idx}_certificado`] = certificado;
      answers[`cuadrilla_${idx}_cargo`] = answers[`cuadrilla_${idx}_cargo`] || cargo;
      answers[`cuadrilla_${idx}_seg_social`] = segSocial;

      answers[`ejecutor_${idx}_cedula`] = answers[`ejecutor_${idx}_cedula`] || cedula;
      answers[`ejecutor_${idx}_nombre`] = answers[`ejecutor_${idx}_nombre`] || nombre;
      answers[`ejecutor_${idx}_certificado`] = certificado;
      answers[`ejecutor_${idx}_cargo`] = answers[`ejecutor_${idx}_cargo`] || cargo;
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
}
