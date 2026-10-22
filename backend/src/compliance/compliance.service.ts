import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateArlStatus, selectArlAffiliation, type ArlStatus } from '../arl/arl-status';
import { businessDate } from '../common/business-date';

export type RequisitoEstado = 'VIGENTE' | 'PROXIMA_A_VENCER' | 'VENCIDA' | 'NO_APLICA';

/** Cumplimiento de una persona en un instante dado. */
export interface Cumplimiento {
  collaboratorId: string;
  arl: { estado: ArlStatus; providerName?: string; endDate?: string };
  seguridadSocial: { estado: RequisitoEstado; reference?: string; periodEnd?: string };
  alturas: { estado: RequisitoEstado; expiresAt?: string; trainingEntity?: string };
  apto: boolean;
  faltantes: string[];
}

export type Requisito = 'ARL' | 'SEGURIDAD_SOCIAL' | 'ALTURAS';

/**
 * Un requisito vencido o que vence dentro del plazo consultado. `cubiertoHasta`
 * es el último día con cobertura continua desde hoy: una renovación ya cargada
 * que empieza al terminar la vigente lo extiende, así no se avisa en vano.
 */
export interface Vencimiento {
  collaboratorId: string;
  requisito: Requisito;
  estado: 'VENCIDO' | 'POR_VENCER';
  cubiertoHasta: string | null;
  diasRestantes: number | null;
  detalle?: string;
}

const DIA_MS = 86_400_000;

/**
 * Si un colaborador debe tener certificado de alturas vigente. Lo decide su
 * cargo del catálogo; el texto del cargo solo cuenta para registros antiguos
 * que aún no tienen uno (REQ-001: solo el Oficial eléctrico).
 */
export function exigeCertificadoAlturas(colaborador: {
  jobTitle: string | null;
  jobPosition: { requiresHeightCertificate: boolean } | null;
}): boolean {
  if (colaborador.jobPosition) return colaborador.jobPosition.requiresHeightCertificate;
  return (
    (colaborador.jobTitle ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase() === 'OFICIAL ELECTRICO'
  );
}

/**
 * Decide si un colaborador puede subir a trabajar hoy.
 *
 * Son tres requisitos y los tres bloquean por igual: afiliación a la ARL,
 * cobertura en una planilla de seguridad social vigente y certificado de
 * trabajo seguro en alturas. Quien no los cumpla no aparece siquiera en la
 * lista desde la que el oficial arma su cuadrilla.
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluar(collaboratorIds: string[], now = new Date()): Promise<Map<string, Cumplimiento>> {
    if (!collaboratorIds.length) return new Map();
    const diasAviso = await this.diasParaAviso();

    const { afiliaciones, coberturas, certificados, cargos } = await this.registros(collaboratorIds);

    const resultado = new Map<string, Cumplimiento>();
    for (const collaboratorId of collaboratorIds) {
      // Cuenta el registro que cubre hoy, no el de vencimiento más lejano: una
      // planilla que empieza el mes entrante no puede tapar a la que rige ahora.
      // Si ninguno cubre hoy se toma el más reciente, solo para informar.
      const afiliacion = selectArlAffiliation(
        afiliaciones.filter((item) => item.collaboratorId === collaboratorId),
        now,
      );
      const cobertura = this.vigenteHoy(
        coberturas.filter((item) => item.collaboratorId === collaboratorId),
        (item) => [item.payroll.periodStart, item.payroll.periodEnd],
        now,
      );
      const certificado = this.vigenteHoy(
        certificados.filter((item) => item.collaboratorId === collaboratorId),
        (item) => [item.issuedAt, item.expiresAt],
        now,
      );

      const arl: ArlStatus = afiliacion
        ? calculateArlStatus(afiliacion.startDate, afiliacion.endDate, diasAviso, now)
        : 'VENCIDA';
      const seguridadSocial = cobertura
        ? this.estadoPorVigencia(cobertura.payroll.periodStart, cobertura.payroll.periodEnd, diasAviso, now)
        : 'VENCIDA';
      const requiereAlturas = cargos.get(collaboratorId) ?? false;
      const alturas: RequisitoEstado = requiereAlturas
        ? certificado
          ? this.estadoPorVigencia(certificado.issuedAt, certificado.expiresAt, diasAviso, now)
          : 'VENCIDA'
        : 'NO_APLICA';

      const faltantes: string[] = [];
      if (arl === 'VENCIDA') faltantes.push('ARL');
      if (seguridadSocial === 'VENCIDA') faltantes.push('Seguridad social');
      if (requiereAlturas && alturas === 'VENCIDA') faltantes.push('Certificado de alturas');

      resultado.set(collaboratorId, {
        collaboratorId,
        arl: {
          estado: arl,
          providerName: afiliacion?.providerName,
          endDate: afiliacion?.endDate.toISOString(),
        },
        seguridadSocial: {
          estado: seguridadSocial,
          reference: cobertura?.payroll.reference,
          periodEnd: cobertura?.payroll.periodEnd.toISOString(),
        },
        alturas: {
          estado: alturas,
          expiresAt: certificado?.expiresAt.toISOString(),
          trainingEntity: certificado?.trainingEntity ?? undefined,
        },
        apto: faltantes.length === 0,
        faltantes,
      });
    }
    return resultado;
  }

  async evaluarUno(collaboratorId: string, now = new Date()): Promise<Cumplimiento> {
    const mapa = await this.evaluar([collaboratorId], now);
    return mapa.get(collaboratorId)!;
  }

  /**
   * Requisitos vencidos o que vencen dentro de `dias`, ordenados por urgencia.
   * Sirve para avisar con tiempo, antes de que alguien quede fuera de su cuadrilla.
   */
  async vencimientos(collaboratorIds: string[], dias: number, now = new Date()): Promise<Vencimiento[]> {
    if (!collaboratorIds.length) return [];
    const { afiliaciones, coberturas, certificados, cargos } = await this.registros(collaboratorIds);
    const hoy = businessDate(now).getTime();
    const limite = hoy + Math.max(0, dias) * DIA_MS;
    const resultado: Vencimiento[] = [];

    const revisar = (
      collaboratorId: string,
      requisito: Requisito,
      rangos: { desde: Date; hasta: Date; detalle?: string }[],
    ) => {
      const hasta = this.cubiertoHasta(rangos, now);
      if (hasta !== null && hasta > limite) return;
      const ultimo = rangos.reduce<(typeof rangos)[number] | undefined>(
        (mayor, rango) => (!mayor || rango.hasta > mayor.hasta ? rango : mayor),
        undefined,
      );
      // Vencido: se informa la última fecha que tuvo cobertura, si la hubo.
      const referencia = hasta ?? (ultimo ? this.dia(ultimo.hasta) : null);
      resultado.push({
        collaboratorId,
        requisito,
        estado: hasta === null ? 'VENCIDO' : 'POR_VENCER',
        cubiertoHasta: referencia === null ? null : new Date(referencia).toISOString().slice(0, 10),
        diasRestantes: hasta === null ? null : Math.round((hasta - hoy) / DIA_MS),
        detalle: ultimo?.detalle,
      });
    };

    for (const collaboratorId of collaboratorIds) {
      revisar(
        collaboratorId,
        'ARL',
        afiliaciones
          .filter((item) => item.collaboratorId === collaboratorId)
          .map((item) => ({ desde: item.startDate, hasta: item.endDate, detalle: item.providerName })),
      );
      revisar(
        collaboratorId,
        'SEGURIDAD_SOCIAL',
        coberturas
          .filter((item) => item.collaboratorId === collaboratorId)
          .map((item) => ({
            desde: item.payroll.periodStart,
            hasta: item.payroll.periodEnd,
            detalle: item.payroll.reference,
          })),
      );
      if (cargos.get(collaboratorId)) {
        revisar(
          collaboratorId,
          'ALTURAS',
          certificados
            .filter((item) => item.collaboratorId === collaboratorId)
            .map((item) => ({
              desde: item.issuedAt,
              hasta: item.expiresAt,
              detalle: item.trainingEntity ?? undefined,
            })),
        );
      }
    }
    // Primero lo vencido, luego lo que vence antes.
    return resultado.sort((a, b) => (a.diasRestantes ?? -1) - (b.diasRestantes ?? -1));
  }

  private async registros(collaboratorIds: string[]) {
    const [afiliaciones, coberturas, certificados, colaboradores] = await Promise.all([
      this.prisma.arlAffiliation.findMany({
        where: { collaboratorId: { in: collaboratorIds } },
        orderBy: { endDate: 'desc' },
      }),
      this.prisma.payrollMembership.findMany({
        where: { collaboratorId: { in: collaboratorIds } },
        include: { payroll: true },
        orderBy: { payroll: { periodEnd: 'desc' } },
      }),
      this.prisma.heightCertificate.findMany({
        where: { collaboratorId: { in: collaboratorIds } },
        orderBy: { expiresAt: 'desc' },
      }),
      this.prisma.collaborator.findMany({
        where: { id: { in: collaboratorIds } },
        select: { id: true, jobTitle: true, jobPosition: { select: { requiresHeightCertificate: true } } },
      }),
    ]);
    const cargos = new Map(colaboradores.map((colaborador) => [colaborador.id, exigeCertificadoAlturas(colaborador)]));
    return { afiliaciones, coberturas, certificados, cargos };
  }

  /**
   * Último día (en ms UTC) de cobertura continua a partir de hoy, o `null` si
   * hoy no hay cobertura. Encadena registros que empiezan, a más tardar, el día
   * siguiente al fin del anterior.
   */
  private cubiertoHasta(rangos: { desde: Date; hasta: Date }[], now: Date): number | null {
    const hoy = businessDate(now).getTime();
    const dias = rangos.map((rango) => ({ desde: this.dia(rango.desde), hasta: this.dia(rango.hasta) }));
    let fin: number | null = null;
    for (const rango of dias) {
      if (rango.desde <= hoy && rango.hasta >= hoy && (fin === null || rango.hasta > fin)) fin = rango.hasta;
    }
    if (fin === null) return null;
    let extendido = true;
    while (extendido) {
      extendido = false;
      for (const rango of dias) {
        if (rango.desde <= fin + DIA_MS && rango.hasta > fin) {
          fin = rango.hasta;
          extendido = true;
        }
      }
    }
    return fin;
  }

  private dia(fecha: Date): number {
    return Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  }

  /**
   * De varios registros del mismo requisito, elige el que ampara hoy. Si
   * ninguno lo hace, devuelve el más reciente para poder decir qué falta.
   */
  private vigenteHoy<T>(registros: T[], rango: (registro: T) => [Date, Date], now: Date): T | undefined {
    if (!registros.length) return undefined;
    const hoy = businessDate(now).getTime();
    const dia = (fecha: Date) => Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
    return (
      registros.find((registro) => {
        const [desde, hasta] = rango(registro);
        return dia(desde) <= hoy && hoy <= dia(hasta);
      }) ?? registros[0]
    );
  }

  /** Los tres requisitos se evalúan como días calendario, igual que la ARL. */
  private estadoPorVigencia(desde: Date, hasta: Date, diasAviso: number, now: Date): RequisitoEstado {
    return calculateArlStatus(desde, hasta, diasAviso, now);
  }

  private async diasParaAviso(): Promise<number> {
    const ajuste = await this.prisma.systemSetting.findUnique({ where: { key: 'arl_expiring_days' } });
    return typeof ajuste?.valueJson === 'number' && Number.isInteger(ajuste.valueJson) ? ajuste.valueJson : 30;
  }
}
