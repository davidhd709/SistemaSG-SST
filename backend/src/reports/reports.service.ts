import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { AuthenticatedRequest } from '../common/request-context';
import { businessDate } from '../common/business-date';
import { AuditService } from '../audit/audit.service';
import { ComplianceService, type RequisitoEstado } from '../compliance/compliance.service';
import { PrismaService } from '../prisma/prisma.service';

const DIA_MS = 86_400_000;
/** Un año más un día: alcanza para un año calendario completo, bisiesto incluido. */
const MAX_DIAS = 366;
/** Colombia no tiene horario de verano: la diferencia con UTC es fija. */
const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

const ESTADOS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de autorización',
  APPROVED: 'Autorizado',
  CLOSED: 'Cerrado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Vencido',
};

const REQUISITOS: Record<RequisitoEstado, string> = {
  VIGENTE: 'Vigente',
  PROXIMA_A_VENCER: 'Próximo a vencer',
  VENCIDA: 'Vencido',
  NO_APLICA: 'No aplica',
};

type Rango = { desde: Date; hasta: Date; from: string; to: string };

const PERMISO_INCLUDE = {
  collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
  members: {
    include: {
      collaborator: { select: { firstName: true, lastName: true, documentNumber: true } },
      jobPosition: { select: { name: true } },
    },
  },
  approval: { include: { decidedBy: { select: { email: true } } } },
  closedBy: { select: { firstName: true, lastName: true } },
  closedByUser: { select: { email: true } },
  correction: { select: { id: true } },
  formVersion: { select: { versionNumber: true, form: { select: { code: true, name: true } } } },
} satisfies Prisma.FormSubmissionInclude;

type Permiso = Prisma.FormSubmissionGetPayload<{ include: typeof PERMISO_INCLUDE }>;

/**
 * Reportes en Excel para Coordinación, Administración y Legal. Reúne en un
 * solo archivo los permisos de un periodo, sus rechazos y el estado actual
 * de cumplimiento de la plantilla, con el formato de fechas de Colombia.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
  ) {}

  async submissionsWorkbook(
    from: string,
    to: string,
    request: AuthenticatedRequest,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const rango = this.rango(from, to);
    const permisos = await this.prisma.formSubmission.findMany({
      where: { status: { not: 'DRAFT' }, workDate: { gte: rango.desde, lte: rango.hasta } },
      include: PERMISO_INCLUDE,
      orderBy: [{ workDate: 'asc' }, { submittedAt: 'asc' }],
    });

    const libro = new ExcelJS.Workbook();
    libro.creator = 'Sistema SG-SST';
    libro.created = new Date();

    this.hojaResumen(libro, rango, permisos);
    this.hojaPermisos(libro, permisos);
    this.hojaRechazos(libro, permisos);
    await this.hojaCumplimiento(libro);

    const buffer = Buffer.from(await libro.xlsx.writeBuffer());
    // Exporta datos personales de la plantilla: queda constancia de quién y qué.
    await this.audit.record({
      actorUserId: request.principal?.kind === 'USER' ? request.principal.userId : undefined,
      action: 'EXPORT_SUBMISSIONS_REPORT',
      entityType: 'REPORT',
      entityId: `submissions:${rango.from}:${rango.to}`,
      afterJson: { from: rango.from, to: rango.to, submissions: permisos.length },
      ip: request.ip,
      userAgent: request.header('user-agent'),
      correlationId: request.correlationId ?? 'unknown',
    });
    return { buffer, filename: `reporte-permisos-${rango.from}_${rango.to}.xlsx` };
  }

  private rango(from: string, to: string): Rango {
    // Una fecha imposible (31 de febrero) no sobrevive a la ida y vuelta por Date.
    const dia = (valor: string) => {
      const fecha = new Date(`${valor}T00:00:00.000Z`);
      if (Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== valor) {
        throw new BadRequestException('Las fechas del reporte no son válidas.');
      }
      return fecha;
    };
    const desde = dia(from);
    const hasta = dia(to);
    if (hasta < desde) throw new BadRequestException('La fecha final no puede ser anterior a la inicial.');
    if ((hasta.getTime() - desde.getTime()) / DIA_MS + 1 > MAX_DIAS) {
      throw new BadRequestException(`El reporte admite hasta ${MAX_DIAS} días.`);
    }
    return { desde, hasta, from, to };
  }

  // ── Hojas ────────────────────────────────────────────────────────────
  private hojaResumen(libro: ExcelJS.Workbook, rango: Rango, permisos: Permiso[]) {
    const hoja = libro.addWorksheet('Resumen');
    hoja.columns = [{ width: 44 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 14 }];
    hoja.addRow(['Reporte de permisos de trabajo en altura']).font = { bold: true, size: 14 };
    hoja.addRow([`Fechas de trabajo del ${this.diaTexto(rango.desde)} al ${this.diaTexto(rango.hasta)}`]);
    hoja.addRow([`Generado el ${this.instanteTexto(new Date())} (hora de Colombia)`]);
    hoja.addRow([]);

    const contar = (estado: string) => permisos.filter((permiso) => permiso.status === estado).length;
    const decididos = permisos.filter((permiso) => permiso.approval && permiso.submittedAt);
    const aprobados = decididos.filter((permiso) => permiso.approval!.decision === 'APPROVED').length;
    const minutosDecision = decididos.map((permiso) => this.minutos(permiso.submittedAt!, permiso.approval!.decidedAt));
    const jornadas = permisos.filter((permiso) => permiso.startedAt && permiso.closedAt);
    const horasJornada = jornadas.map((permiso) => this.minutos(permiso.startedAt!, permiso.closedAt!) / 60);

    const indicadores: [string, number | string][] = [
      ['Permisos enviados', permisos.length],
      ['Cerrados', contar('CLOSED')],
      ['Autorizados sin cerrar', contar('APPROVED')],
      ['Pendientes de autorización', contar('PENDING_APPROVAL')],
      ['Rechazados', contar('REJECTED')],
      ['Vencidos sin iniciar', contar('EXPIRED')],
      ['Correcciones de permisos rechazados', permisos.filter((permiso) => permiso.previousSubmissionId).length],
      ['Tasa de aprobación', decididos.length ? aprobados / decididos.length : '—'],
      ['Minutos promedio hasta la decisión', this.promedio(minutosDecision)],
      ['Horas promedio por jornada', this.promedio(horasJornada)],
      ['Integrantes promedio por cuadrilla', this.promedio(permisos.map((permiso) => permiso.members.length))],
    ];
    const encabezado = hoja.addRow(['Indicador', 'Valor']);
    this.estiloEncabezado(encabezado);
    for (const [nombre, valor] of indicadores) {
      const fila = hoja.addRow([nombre, valor]);
      if (nombre === 'Tasa de aprobación' && typeof valor === 'number') fila.getCell(2).numFmt = '0.0%';
      else if (typeof valor === 'number' && !Number.isInteger(valor)) fila.getCell(2).numFmt = '0.0';
    }

    hoja.addRow([]);
    const porOficial = new Map<
      string,
      { nombre: string; documento: string; total: number; cerrados: number; rechazados: number }
    >();
    for (const permiso of permisos) {
      const clave = permiso.collaboratorId;
      const actual = porOficial.get(clave) ?? {
        nombre: `${permiso.collaborator.firstName} ${permiso.collaborator.lastName}`,
        documento: permiso.collaborator.documentNumber,
        total: 0,
        cerrados: 0,
        rechazados: 0,
      };
      actual.total++;
      if (permiso.status === 'CLOSED') actual.cerrados++;
      if (permiso.status === 'REJECTED') actual.rechazados++;
      porOficial.set(clave, actual);
    }
    this.estiloEncabezado(hoja.addRow(['Oficial que diligencia', 'Documento', 'Permisos', 'Cerrados', 'Rechazados']));
    for (const oficial of [...porOficial.values()].sort((a, b) => b.total - a.total)) {
      hoja.addRow([oficial.nombre, oficial.documento, oficial.total, oficial.cerrados, oficial.rechazados]);
    }
  }

  private hojaPermisos(libro: ExcelJS.Workbook, permisos: Permiso[]) {
    const hoja = libro.addWorksheet('Permisos', { views: [{ state: 'frozen', ySplit: 1 }] });
    hoja.columns = [
      { header: 'Fecha de trabajo', key: 'workDate', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Estado', key: 'estado', width: 24 },
      { header: 'Oficial', key: 'oficial', width: 28 },
      { header: 'Documento', key: 'documento', width: 14 },
      { header: 'Cuadrilla', key: 'cuadrilla', width: 50 },
      { header: 'Integrantes', key: 'integrantes', width: 11 },
      { header: 'Enviado', key: 'enviado', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Decisión', key: 'decision', width: 12 },
      { header: 'Decidido por', key: 'decididoPor', width: 28 },
      { header: 'Decidido', key: 'decidido', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Minutos hasta la decisión', key: 'minutosDecision', width: 13 },
      { header: 'Motivo u observación', key: 'motivo', width: 40 },
      { header: 'Inicio', key: 'inicio', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Cierre', key: 'cierre', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Horas de jornada', key: 'horas', width: 11, style: { numFmt: '0.00' } },
      { header: 'Cerrado por', key: 'cerradoPor', width: 28 },
      { header: 'Novedades de cierre', key: 'notas', width: 40 },
      { header: 'Corrige un rechazo', key: 'esCorreccion', width: 11 },
      { header: 'PDF final', key: 'pdf', width: 10 },
      { header: 'Formato', key: 'formato', width: 16 },
      { header: 'Identificador', key: 'id', width: 38 },
    ];
    this.estiloEncabezado(hoja.getRow(1));
    for (const permiso of permisos) {
      const cerradoPor = permiso.closedByUser
        ? `${permiso.closedByUser.email} (cierre administrativo)`
        : permiso.closedBy
          ? `${permiso.closedBy.firstName} ${permiso.closedBy.lastName}`
          : '';
      hoja.addRow({
        workDate: permiso.workDate ?? undefined,
        estado: ESTADOS[permiso.status] ?? permiso.status,
        oficial: `${permiso.collaborator.firstName} ${permiso.collaborator.lastName}`,
        documento: permiso.collaborator.documentNumber,
        cuadrilla: permiso.members
          .map(
            (integrante) =>
              `${integrante.collaborator.firstName} ${integrante.collaborator.lastName}` +
              (integrante.jobPosition ? ` (${integrante.jobPosition.name})` : ''),
          )
          .join(', '),
        integrantes: permiso.members.length,
        enviado: this.local(permiso.submittedAt),
        decision: permiso.approval ? (permiso.approval.decision === 'APPROVED' ? 'Autorizado' : 'Rechazado') : '',
        decididoPor: permiso.approval?.decidedBy.email ?? '',
        decidido: this.local(permiso.approval?.decidedAt),
        minutosDecision:
          permiso.approval && permiso.submittedAt
            ? Math.round(this.minutos(permiso.submittedAt, permiso.approval.decidedAt))
            : undefined,
        motivo: permiso.approval?.reason ?? '',
        inicio: this.local(permiso.startedAt),
        cierre: this.local(permiso.closedAt),
        horas:
          permiso.startedAt && permiso.closedAt ? this.minutos(permiso.startedAt, permiso.closedAt) / 60 : undefined,
        cerradoPor,
        notas: permiso.closureNotes ?? '',
        esCorreccion: permiso.previousSubmissionId ? 'Sí' : 'No',
        pdf: permiso.finalPdfFileId ? 'Sí' : 'No',
        formato: `${permiso.formVersion.form.code} v${permiso.formVersion.versionNumber}`,
        id: permiso.id,
      });
    }
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
  }

  private hojaRechazos(libro: ExcelJS.Workbook, permisos: Permiso[]) {
    const hoja = libro.addWorksheet('Rechazos', { views: [{ state: 'frozen', ySplit: 1 }] });
    hoja.columns = [
      { header: 'Fecha de trabajo', key: 'workDate', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Oficial', key: 'oficial', width: 28 },
      { header: 'Documento', key: 'documento', width: 14 },
      { header: 'Motivo', key: 'motivo', width: 60 },
      { header: 'Rechazado por', key: 'decididoPor', width: 28 },
      { header: 'Rechazado', key: 'decidido', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Corregido y reenviado', key: 'corregido', width: 14 },
    ];
    this.estiloEncabezado(hoja.getRow(1));
    for (const permiso of permisos.filter((item) => item.approval?.decision === 'REJECTED')) {
      hoja.addRow({
        workDate: permiso.workDate ?? undefined,
        oficial: `${permiso.collaborator.firstName} ${permiso.collaborator.lastName}`,
        documento: permiso.collaborator.documentNumber,
        motivo: permiso.approval?.reason ?? '',
        decididoPor: permiso.approval?.decidedBy.email ?? '',
        decidido: this.local(permiso.approval?.decidedAt),
        corregido: permiso.correction ? 'Sí' : 'No',
      });
    }
  }

  /** Foto del cumplimiento al momento de exportar, no del periodo consultado. */
  private async hojaCumplimiento(libro: ExcelJS.Workbook) {
    const colaboradores = await this.prisma.collaborator.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, documentNumber: true, jobTitle: true, team: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const cumplimientos = await this.compliance.evaluar(colaboradores.map((persona) => persona.id));
    const hoja = libro.addWorksheet('Cumplimiento hoy', { views: [{ state: 'frozen', ySplit: 1 }] });
    hoja.columns = [
      { header: 'Colaborador', key: 'nombre', width: 28 },
      { header: 'Documento', key: 'documento', width: 14 },
      { header: 'Cargo', key: 'cargo', width: 22 },
      { header: 'Equipo', key: 'equipo', width: 16 },
      { header: 'ARL', key: 'arl', width: 16 },
      { header: 'ARL hasta', key: 'arlHasta', width: 13, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Seguridad social', key: 'social', width: 16 },
      { header: 'Planilla hasta', key: 'socialHasta', width: 13, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Certificado de alturas', key: 'alturas', width: 16 },
      { header: 'Certificado hasta', key: 'alturasHasta', width: 13, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Puede subir hoy', key: 'apto', width: 12 },
      { header: 'Le falta', key: 'faltantes', width: 36 },
    ];
    this.estiloEncabezado(hoja.getRow(1));
    for (const persona of colaboradores) {
      const cumplimiento = cumplimientos.get(persona.id)!;
      const fecha = (valor?: string) => (valor ? new Date(valor) : undefined);
      hoja.addRow({
        nombre: `${persona.firstName} ${persona.lastName}`,
        documento: persona.documentNumber,
        cargo: persona.jobTitle ?? '',
        equipo: persona.team ?? '',
        arl: REQUISITOS[cumplimiento.arl.estado],
        arlHasta: fecha(cumplimiento.arl.endDate),
        social: REQUISITOS[cumplimiento.seguridadSocial.estado],
        socialHasta: fecha(cumplimiento.seguridadSocial.periodEnd),
        alturas: REQUISITOS[cumplimiento.alturas.estado],
        alturasHasta: fecha(cumplimiento.alturas.expiresAt),
        apto: cumplimiento.apto ? 'Sí' : 'No',
        faltantes: cumplimiento.faltantes.join(', '),
      });
    }
    hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: hoja.columnCount } };
  }

  // ── Utilidades ───────────────────────────────────────────────────────
  /**
   * Excel no guarda zona horaria: muestra la fecha tal cual llega. Se corre el
   * instante a la hora de Colombia para que el archivo muestre la hora local.
   */
  private local(valor: Date | null | undefined): Date | undefined {
    return valor ? new Date(valor.getTime() + BOGOTA_OFFSET_MS) : undefined;
  }

  private minutos(desde: Date, hasta: Date): number {
    return (hasta.getTime() - desde.getTime()) / 60_000;
  }

  private promedio(valores: number[]): number | string {
    return valores.length ? valores.reduce((suma, valor) => suma + valor, 0) / valores.length : '—';
  }

  private diaTexto(fecha: Date): string {
    return fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  private instanteTexto(fecha: Date): string {
    const dia = businessDate(fecha);
    const hora = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota' });
    return `${this.diaTexto(dia)} a las ${hora}`;
  }

  private estiloEncabezado(fila: ExcelJS.Row) {
    fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fila.eachCell((celda) => {
      celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      celda.alignment = { vertical: 'middle', wrapText: true };
    });
  }
}
