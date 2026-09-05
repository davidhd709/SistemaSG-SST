import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../files/storage.service';

type PdfSubmission = {
  id: string;
  submittedAt: Date | null;
  workDate: Date | null;
  startedAt: Date | null;
  closedAt: Date | null;
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

/** Un integrante de la cuadrilla con su firma ya resuelta como imagen. */
type PdfMember = {
  nombre: string;
  documento: string;
  cargo: string;
  esResponsable: boolean;
  firmaBase64: string | null;
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

    // Cada integrante firma la suya; si alguna falta, el documento lo deja ver
    // en lugar de fallar: el permiso ya está decidido y debe quedar constancia.
    const integrantes: PdfMember[] = await Promise.all(
      submission.members.map(async (member) => ({
        nombre: `${member.collaborator.firstName} ${member.collaborator.lastName}`,
        documento: member.collaborator.documentNumber,
        cargo: member.jobPosition?.name ?? member.collaborator.jobTitle ?? '—',
        esResponsable: member.isLead,
        firmaBase64: member.signature
          ? await this.storage
              .getObject(member.signature.file.objectKey)
              .then((contenido) => contenido.toString('base64'))
              .catch(() => null)
          : null,
      })),
    );
    const html = this.template(submission as PdfSubmission, integrantes);
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
  /**
   * Reproduce la plantilla corporativa HSE-FO-016: una sola hoja horizontal,
   * con bloques fijos para que el impreso conserve la misma lectura del formato
   * aprobado, aunque cambie la cantidad de opciones seleccionadas en el portal.
   */
  private template(submission: PdfSubmission, integrantes: PdfMember[]): string {
    const answers = submission.answersJson as Record<string, unknown>;
    const schema = submission.formVersion.schemaJson as { fields?: FormField[] };
    const fields = (schema.fields ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const value = (id: string) => this.answer(answers[id]);
    const plainValue = (id: string) => this.escape(value(id));
    const marked = (id: string, option: string) => this.optionMarked(answers[id], option);
    const checked = (id: string, option: string) => `${marked(id, option) ? '&#9745;' : '&#9744;'}`;
    const yesNo = (id: string) =>
      `<span class="choice">${checked(id, 'SI')} Sí</span><span class="choice">${checked(id, 'NO')} No</span>`;
    const checklist = fields.filter((field) => field.id.startsWith('verificacion_'));
    const checklistCell = (field: FormField | undefined) => {
      if (!field) return '<td class="verify-text"></td><td></td><td></td><td></td>';
      return `<td class="verify-text">${this.escape(field.label)}</td><td class="mark">${checked(field.id, 'SI')}</td><td class="mark">${checked(field.id, 'NO')}</td><td class="mark">${checked(field.id, 'N/A')}</td>`;
    };
    const checklistRows = Array.from(
      { length: Math.ceil(checklist.length / 2) },
      (_, index) =>
        `<tr>${checklistCell(checklist[index])}${checklistCell(checklist[index + Math.ceil(checklist.length / 2)])}</tr>`,
    ).join('');
    const crewRows = [...integrantes, ...Array.from({ length: Math.max(0, 4 - integrantes.length) }, () => null)]
      .map((person) => {
        if (!person) return '<tr class="crew-empty"><td></td><td></td><td></td><td></td><td></td><td></td></tr>';
        return `<tr><td>${this.escape(person.documento)}</td><td>${this.escape(person.nombre)}</td><td>${person.esResponsable ? plainValue('certificado_alturas') : '—'}</td><td>${this.escape(person.cargo)}</td><td>${person.esResponsable ? plainValue('seguridad_social_verificada') : 'Verificada'}</td><td class="signature-cell">${person.firmaBase64 ? `<img class="signature" src="data:image/png;base64,${person.firmaBase64}" alt="Firma de ${this.escape(person.nombre)}">` : ''}</td></tr>`;
      })
      .join('');
    const documentDate = this.formatOnlyDate(submission.workDate ?? submission.submittedAt);
    const decision = submission.approval.decision === 'APPROVED' ? 'AUTORIZADO' : 'NO AUTORIZADO';

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
      @page { size: letter landscape; margin: 0; }
      * { box-sizing: border-box; } body { width: 100%; margin: 0; padding: 4mm 5.5mm; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 6.6px; line-height: 1.08; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; } td, th { border: .45px solid #222; padding: .75px 1.5px; vertical-align: middle; overflow-wrap: anywhere; } th { font-weight: 700; text-align: center; }
      .header { height: 25mm; } .logo { width: 27.5%; border: 0; text-align: center; } .logo-mark { display: inline-block; margin-top: 3mm; font-size: 17px; line-height: .8; font-weight: 800; font-style: italic; color: #169447; text-shadow: 0 1px #07598c; } .logo-sub { display: block; font-size: 4.1px; letter-spacing: .5px; color: #126a9b; text-shadow: none; }
      .system { width: 44%; text-align: center; font-size: 7.4px; font-weight: 700; } .document-meta { width: 28.5%; padding: 0; } .document-meta table td { height: 8.3mm; border-width: 0 0 .45px; padding-left: 2px; } .document-meta tr:last-child td { border-bottom: 0; }
      .form-title { text-align: center; font-size: 7.4px; font-weight: 700; height: 5.5mm; } .section-title { background: #d9d9d9; text-align: center; font-weight: 700; text-transform: uppercase; height: 4.4mm; }
      .basic td { height: 5.1mm; } .basic .field { width: 43%; font-weight: 700; } .basic .value { width: 57%; }
      .crew th { height: 7mm; font-size: 6.2px; } .crew td { height: 7mm; } .crew th:nth-child(1) { width: 13%; } .crew th:nth-child(2) { width: 28%; } .crew th:nth-child(3) { width: 14%; } .crew th:nth-child(4) { width: 14%; } .crew th:nth-child(5) { width: 14%; } .crew th:nth-child(6) { width: 17%; } .crew-empty td { height: 7mm; }
      .signature { display: block; width: 100%; height: 10mm; object-fit: contain; } .signature-cell { padding: 0; text-align: center; }
      .single td { min-height: 5.3mm; height: 5.3mm; } .single .field { width: 32%; font-weight: 700; } .choice { display: inline-block; margin-right: 5px; white-space: nowrap; } .access td { height: 5.6mm; } .access .field { width: 16%; font-weight: 700; } .access .option { width: 11%; text-align: center; }
      .epp-caption { height: 4.7mm; font-weight: 700; } .epp td { height: 5mm; } .epp .item { width: 13.5%; } .epp .answer { width: 3.15%; white-space: nowrap; text-align: center; } .epp .wide { width: 22%; } .epp .other-answer { width: 5%; text-align: center; }
      .checklist { break-inside: auto; } .checklist thead { display: table-header-group; } .checklist tr { break-inside: avoid; } .checklist th { height: 5mm; } .verify-text { width: 37%; height: 9.2mm; } .mark { width: 4.33%; text-align: center; font-size: 7px; }
      .responsible td { height: 5.5mm; } .responsible .who { width: 73%; font-weight: 700; } .responsible .sign { width: 27%; text-align: center; font-weight: 700; }
      .notice { border: .45px solid #222; border-top: 0; min-height: 5mm; padding: 1.5px 2px; font-size: 5.5px; } .muted { color: #333; }
    </style></head><body>
      <table class="header"><tr><td class="logo"><span class="logo-mark">E.S.O.<span class="logo-sub">INGENIERÍA</span></span></td><td class="system">SISTEMA DE GESTIÓN DE SEGURIDAD Y SALUD EN EL TRABAJO</td><td class="document-meta"><table><tr><td><b>FECHA:</b> 30/09/2022</td></tr><tr><td><b>CÓDIGO:</b> ${this.escape(submission.formVersion.form.code)}</td></tr><tr><td><b>VERSIÓN:</b> 00</td></tr></table></td></tr></table>
      <table><tr><td class="form-title" colspan="2">PERMISO DE TRABAJO EN ALTURA</td></tr><tr><td class="section-title" colspan="2">1. Datos básicos del permiso de trabajo en altura</td></tr></table>
      <table class="basic"><tr><td class="field">Empresa:</td><td class="value">${plainValue('empresa')}</td><td class="field">Fecha de realización del trabajo:</td><td class="value">${plainValue('fecha_trabajo')}</td></tr><tr><td class="field">Área / Proceso:</td><td class="value">${plainValue('area_proceso')}</td><td class="field">Lugar de trabajo:</td><td class="value">${plainValue('lugar_trabajo')}</td></tr><tr><td class="field">Ubicación donde se realiza el trabajo:</td><td class="value">${plainValue('ubicacion_trabajo')}</td><td class="field">Vigencia del permiso:</td><td class="value">${plainValue('vigencia_permiso')}</td></tr></table>
      <table class="crew"><thead><tr><th>Cédula<br>(Ejecutor)</th><th>Nombres y apellidos (Ejecutor)</th><th>Certificado para<br>trabajo en alturas</th><th>Cargo</th><th>Verificación de<br>seguridad social</th><th>Firma</th></tr></thead><tbody>${crewRows}</tbody></table>
      <table><tr><td class="section-title">2. Descripción del trabajo a realizar</td></tr></table><table class="single"><tr><td class="field">Tipos de trabajos en alturas a realizar:</td><td>${plainValue('tipos_trabajo_altura')}</td></tr><tr><td class="field">Herramientas a utilizar:</td><td>${plainValue('herramientas')}</td></tr><tr><td class="field">Altura aproximada a la cual se va a desarrollar la actividad:</td><td>${plainValue('altura_metros')}</td></tr></table>
      <table><tr><td class="section-title">3. Identificación de peligros y controles</td></tr></table><table class="single"><tr><td class="field">Peligros identificados:</td><td>${plainValue('peligros')}</td></tr><tr><td class="field">Controles ejecutados:</td><td>${plainValue('controles')}</td></tr></table>
      <table><tr><td class="section-title">4. Medidas de prevención y protección</td></tr></table><table class="access"><tr><td class="field">Sistemas de acceso a utilizar:</td><td class="option">Andamio ${checked('sistemas_acceso', 'Andamio')}</td><td class="option">Escalera ${checked('sistemas_acceso', 'Escalera')}</td><td class="option">Elevador de personal<br>o grúa con canasta ${checked('sistemas_acceso', 'Elevador de personal o grúa con canasta')}</td><td class="field">¿Se involucran otras<br>tareas de alto riesgo?</td><td class="option">${yesNo('otras_tar_involucradas')}</td><td class="option">Espacios confinados ${checked('otras_tar', 'Espacios confinados')}</td><td class="option">Trabajo en caliente ${checked('otras_tar', 'Trabajo en caliente')}</td><td class="option">Energías peligrosas ${checked('otras_tar', 'Energías peligrosas')}</td></tr><tr><td class="field">Otros (¿Cuáles?):</td><td colspan="3">${plainValue('otras_tar_detalle')}</td><td class="field">Otras:</td><td colspan="4">${checked('otras_tar', 'Otras')}</td></tr><tr><td class="field">Procedimiento de la actividad a desarrollar:</td><td colspan="8">${plainValue('procedimiento')}</td></tr></table>
      <table><tr><td class="epp-caption">Elementos de protección personal y sistemas de protección contra caídas:</td></tr></table><table class="epp"><tr><td class="item">Casco dieléctrico</td><td class="answer">${yesNo('epp_01')}</td><td class="item">Arnés dieléctrico</td><td class="answer">${yesNo('epp_02')}</td><td class="item">Eslinga con absorbedor</td><td class="answer">${yesNo('epp_03')}</td><td class="item">Línea de posicionamiento</td><td class="answer">${yesNo('epp_04')}</td><td class="item">Calzado dieléctrico</td><td class="answer">${yesNo('epp_05')}</td></tr><tr><td class="item">Línea de vida vertical</td><td class="answer">${yesNo('epp_06')}</td><td class="item">Sistema de anclaje</td><td class="answer">${yesNo('epp_07')}</td><td class="item">Guantes</td><td class="answer">${yesNo('epp_08')}</td><td class="item">Línea de vida horizontal</td><td class="answer">${yesNo('epp_09')}</td><td class="item">Gafas</td><td class="answer">${yesNo('epp_10')}</td></tr><tr><td class="wide" colspan="3">Otros elementos de protección personal o sistemas de protección contra caídas:</td><td class="other-answer">${yesNo('epp_otros')}</td><td colspan="6">${plainValue('epp_otros_detalle')}</td></tr></table>
      <table class="checklist"><thead><tr><th colspan="4">Lista de verificación</th><th colspan="4">Lista de verificación</th></tr><tr><th>Verificación</th><th>Sí</th><th>No</th><th>N/A</th><th>Verificación</th><th>Sí</th><th>No</th><th>N/A</th></tr></thead><tbody>${checklistRows}</tbody></table>
      <table class="responsible"><tr><td class="who">Nombre y cédula de la persona que autoriza el trabajo: <span class="muted">${plainValue('autorizador_nombre_documento')}</span></td><td class="sign">Firma</td></tr><tr><td class="who">Nombre y cédula de la persona responsable de activar el plan de emergencia: <span class="muted">${plainValue('responsable_emergencia')}</span></td><td class="sign">Firma</td></tr><tr><td class="who">Nombre y cédula de la persona que autoriza (Coordinador de trabajo en altura): <span class="muted">${plainValue('coordinador_alturas')}</span></td><td class="sign">Firma</td></tr></table>
      <div class="notice">El permiso de trabajo en alturas debe tener en cuenta las medidas para garantizar que se mantenga una distancia segura entre el trabajo y líneas o equipos eléctricos energizados y que se cuente con ${this.escape(decision)} por coordinación (${this.escape(documentDate)}).</div>
    </body></html>`;
  }

  private legacyTemplate(submission: PdfSubmission, integrantes: PdfMember[]): string {
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
      <div class="section"><div class="section-title">Cuadrilla y firmas</div><table><tr><th>Integrante</th><th>Documento</th><th>Cargo</th><th>Firma</th></tr>${integrantes
        .map(
          (persona) =>
            `<tr><td>${this.escape(persona.nombre)}${persona.esResponsable ? ' <span class="small">(responsable)</span>' : ''}</td><td>${this.escape(persona.documento)}</td><td>${this.escape(persona.cargo)}</td><td class="signature-cell">${persona.firmaBase64 ? `<img class="signature" src="data:image/png;base64,${persona.firmaBase64}" alt="Firma de ${this.escape(persona.nombre)}">` : '<span class="small">Sin firma registrada</span>'}</td></tr>`,
        )
        .join(
          '',
        )}</table></div><div class="section"><div class="section-title">Autorización</div><table><tr><td><b>Responsable:</b> ${this.escape(submission.approval.decidedBy.email)}</td><td>${this.escape(submission.approval.decision)}<br><span class="small">Decidido el ${decidedAt}</span></td></tr></table></div>
      <div class="footer"><span>Registro: ${this.escape(submission.id)}</span><span>Enviado: ${submittedAt}</span><span>Charla de seguridad confirmada: ${submission.safetyTalkConfirmedAt ? 'Sí' : 'No'}</span></div>
    </body></html>`;
  }
  private optionMarked(value: unknown, option: string): boolean {
    const normalized = option.trim().toLocaleUpperCase('es-CO');
    const values = Array.isArray(value) ? value : [value];
    return values.some(
      (item) =>
        String(item ?? '')
          .trim()
          .toLocaleUpperCase('es-CO') === normalized,
    );
  }
  private formatOnlyDate(date: Date | null): string {
    return date ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'short' }).format(date) : '—';
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
