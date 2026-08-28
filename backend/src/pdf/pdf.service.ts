import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';

type PdfSubmission = {
  id: string;
  submittedAt: Date | null;
  answersJson: unknown;
  arlSnapshotJson: unknown;
  safetyTalkConfirmedAt: Date | null;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  formVersion: {
    versionNumber: number;
    schemaJson: unknown;
    form: { code: string; name: string };
  };
  approval: { decision: string; reason: string | null; decidedAt: Date; decidedBy: { email: string } };
};

type FormField = {
  id: string;
  label: string;
  section?: string;
  order?: number;
  type?: string;
};

@Injectable()
export class PdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}
  async generateFinalPdf(submissionId: string, actorUserId: string): Promise<string> {
    const submission = await this.prisma.formSubmission.findUnique({
      where: { id: submissionId },
      include: {
        collaborator: true,
        formVersion: { include: { form: true } },
        signature: { include: { file: true } },
        approval: { include: { decidedBy: true } },
        finalPdfFile: true,
      },
    });
    if (!submission) throw new NotFoundException('Envío no encontrado.');
    if (submission.finalPdfFile) return submission.finalPdfFile.id;
    if (!submission.approval || !submission.signature)
      throw new Error('El envío debe estar firmado y decidido antes de generar PDF.');
    const signature = await this.storage.getObject(submission.signature.file.objectKey);
    const html = this.template(submission as PdfSubmission, signature.toString('base64'));
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    let pdf: Buffer;
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'load' });
      pdf = Buffer.from(
        await page.pdf({
          format: 'Letter',
          landscape: true,
          printBackground: true,
          margin: { top: '4mm', right: '4mm', bottom: '4mm', left: '4mm' },
        }),
      );
    } finally {
      await browser.close();
    }
    const stored = await this.storage.putObject({
      objectKey: `pdf/${submission.id}-${randomUUID()}.pdf`,
      body: pdf,
      mimeType: 'application/pdf',
    });
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
  private template(submission: PdfSubmission, signatureBase64: string): string {
    const answers = submission.answersJson as Record<string, unknown>;
    const schema = submission.formVersion.schemaJson as { fields?: FormField[] };
    const fields = (schema.fields ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const value = (id: string) => this.answer(answers[id]);
    const selected = (id: string) => this.selection(value(id));
    const fieldsFor = (section: string) => fields.filter((item) => item.section === section);
    const rows = (section: string) =>
      fieldsFor(section)
        .filter((item) => !item.id.startsWith('verificacion_') && !item.id.startsWith('epp_'))
        .map(
          (item) =>
            `<tr><td class="label">${this.escape(item.label)}</td><td>${this.valueCell(value(item.id))}</td></tr>`,
        )
        .join('');
    const eppRows = fieldsFor('4. Medidas de prevención y protección')
      .filter((item) => item.id.startsWith('epp_'))
      .map(
        (item) =>
          `<tr><td>${this.escape(item.label)}</td><td class="decision">${item.type === 'yes_no' ? selected(item.id) : this.valueCell(value(item.id))}</td></tr>`,
      )
      .join('');
    const checklistRows = fieldsFor('5. Lista de verificación de seguridad')
      .map(
        (item, index) =>
          `<tr><td class="number">${index + 1}</td><td>${this.escape(item.label)}</td><td class="decision">${selected(item.id)}</td></tr>`,
      )
      .join('');
    const fullName = `${submission.collaborator.firstName} ${submission.collaborator.lastName}`;
    const submittedAt = this.formatDate(submission.submittedAt);
    const decidedAt = this.formatDate(submission.approval.decidedAt);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
      @page { size: letter landscape; margin: 0; }
      * { box-sizing: border-box; } body { margin: 0; padding: 4mm; color: #111; font: 6.4px Arial, Helvetica, sans-serif; line-height: 1.08; }
      table { border-collapse: collapse; width: 100%; } td, th { border: .55px solid #1f2937; padding: 1.3px 2.5px; vertical-align: middle; } th { font-weight: 700; }
      .header td { height: 26px; } .brand { width: 28%; font-size: 7.6px; font-weight: 700; text-align: center; color: #123b67; } .title { width: 45%; text-align: center; font-size: 9px; font-weight: 700; text-transform: uppercase; } .meta { width: 27%; padding: 0; } .meta td { border-width: 0 0 .55px; padding: 1px 2.5px; } .meta tr:last-child td { border-bottom: 0; }
      .section { margin-top: 2px; page-break-inside: avoid; } .section-title { background: #d9e6f2; border: .55px solid #1f2937; padding: 2px 3px; font-size: 6.7px; font-weight: 700; text-transform: uppercase; }
      .label { width: 43%; font-weight: 700; } .value { min-height: 9px; } .two-col td { width: 50%; } .grid td { width: 25%; } .grid .label { width: 18%; }
      .decision { width: 78px; text-align: center; white-space: nowrap; } .box { display: inline-block; margin: 0 1px; font-size: 5.8px; } .checked { font-weight: 700; } .number { width: 14px; text-align: center; font-weight: 700; }
      .checklist td { padding: 1px 2px; } .checklist th { text-align: center; background: #eef3f8; } .epp { width: 50%; display: inline-table; vertical-align: top; } .epp + .epp { margin-left: -3px; }
      .signature { width: 120px; height: 27px; object-fit: contain; display: block; margin: 0 auto; } .signature-cell { height: 36px; text-align: center; } .small { font-size: 5.6px; } .footer { margin-top: 2px; border-top: .55px solid #1f2937; padding-top: 2px; display: flex; justify-content: space-between; font-size: 5.6px; }
    </style></head><body>
      <table class="header"><tr><td class="brand">SISTEMA DE GESTIÓN DE SEGURIDAD Y SALUD EN EL TRABAJO</td><td class="title">PERMISO DE TRABAJO EN ALTURA</td><td class="meta"><table><tr><td><b>FECHA:</b> 30/09/2022</td></tr><tr><td><b>CÓDIGO:</b> ${this.escape(submission.formVersion.form.code)}</td></tr><tr><td><b>VERSIÓN:</b> 00</td></tr></table></td></tr></table>
      <div class="section"><div class="section-title">1. Datos básicos del permiso de trabajo en altura</div><table><tbody>${rows('1. Datos básicos del permiso de trabajo en altura')}</tbody></table><table class="two-col"><tr><td><b>Nombre del ejecutor:</b> ${this.escape(fullName)}</td><td><b>Cédula:</b> ${this.escape(submission.collaborator.documentNumber)}</td></tr></table></div>
      <div class="section"><div class="section-title">2. Descripción del trabajo a realizar</div><table><tbody>${rows('2. Descripción del trabajo a realizar')}</tbody></table></div>
      <div class="section"><div class="section-title">3. Identificación de peligros y controles</div><table><tbody>${rows('3. Identificación de peligros y controles')}</tbody></table></div>
      <div class="section"><div class="section-title">4. Medidas de prevención y protección</div><table><tbody>${rows('4. Medidas de prevención y protección')}</tbody></table><p class="small"><b>Elementos de protección personal y sistemas de protección contra caídas</b></p><table class="epp"><tbody>${eppRows}</tbody></table></div>
      <div class="section"><div class="section-title">5. Lista de verificación de seguridad</div><table class="checklist"><thead><tr><th>No.</th><th>Verificación</th><th>Resultado</th></tr></thead><tbody>${checklistRows}</tbody></table></div>
      <div class="section"><div class="section-title">6. Responsables y autorizaciones</div><table><tbody>${rows('6. Responsables y autorizaciones')}<tr><td class="label">Decisión de coordinación</td><td>${this.escape(submission.approval.decision)}</td></tr><tr><td class="label">Responsable que decide</td><td>${this.escape(submission.approval.decidedBy.email)}</td></tr><tr><td class="label">Fecha de decisión</td><td>${decidedAt}</td></tr><tr><td class="label">Observación / motivo</td><td>${this.escape(submission.approval.reason ?? '—')}</td></tr></tbody></table></div>
      <div class="section"><div class="section-title">Firmas</div><table><tr><td><b>Ejecutor:</b> ${this.escape(fullName)}</td><td><b>Responsable / autorizador:</b> ${this.escape(submission.approval.decidedBy.email)}</td></tr><tr><td class="signature-cell"><img class="signature" src="data:image/png;base64,${signatureBase64}" alt="Firma del ejecutor"></td><td class="signature-cell">${this.escape(submission.approval.decision)}<br><span class="small">Decidido el ${decidedAt}</span></td></tr></table></div>
      <div class="footer"><span>Registro: ${this.escape(submission.id)}</span><span>Enviado: ${submittedAt}</span><span>Charla de seguridad confirmada: ${submission.safetyTalkConfirmedAt ? 'Sí' : 'No'}</span></div>
    </body></html>`;
  }
  private answer(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.map((item) => this.answer(item)).join(', ');
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? '—';
  }
  private valueCell(value: string): string {
    return `<span class="value">${this.escape(value)}</span>`;
  }
  private selection(value: string): string {
    const normalized = value.toUpperCase();
    return ['SI', 'NO', 'N/A']
      .map(
        (option) =>
          `<span class="box ${normalized === option ? 'checked' : ''}">${normalized === option ? '☒' : '☐'} ${option}</span>`,
      )
      .join('');
  }
  private formatDate(date: Date | null): string {
    return date ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(date) : '—';
  }
  private escape(value: string): string {
    return value.replace(
      /[&<>'"]/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character,
    );
  }
}
