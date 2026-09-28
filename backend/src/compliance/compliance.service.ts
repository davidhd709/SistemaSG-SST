import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { calculateArlStatus, type ArlStatus } from '../arl/arl-status';
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
        select: { id: true, jobTitle: true },
      }),
    ]);
    const cargos = new Map(colaboradores.map((colaborador) => [colaborador.id, colaborador.jobTitle]));

    const resultado = new Map<string, Cumplimiento>();
    for (const collaboratorId of collaboratorIds) {
      // Cuenta el registro que cubre hoy, no el de vencimiento más lejano: una
      // planilla que empieza el mes entrante no puede tapar a la que rige ahora.
      // Si ninguno cubre hoy se toma el más reciente, solo para informar.
      const afiliacion = this.vigenteHoy(
        afiliaciones.filter((item) => item.collaboratorId === collaboratorId),
        (item) => [item.startDate, item.endDate],
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
      const requiereAlturas = this.esOficialElectrico(cargos.get(collaboratorId));
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

  private esOficialElectrico(cargo: string | null | undefined): boolean {
    return (
      (cargo ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase() === 'OFICIAL ELECTRICO'
    );
  }
}
