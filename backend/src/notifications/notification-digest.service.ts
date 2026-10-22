import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { businessDate, businessDay } from '../common/business-date';
import { ComplianceService, type Requisito } from '../compliance/compliance.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubmissionsService } from '../submissions/submissions.service';
import { NotificationsService } from './notifications.service';

const UNA_HORA_MS = 60 * 60 * 1000;
/** Desde esta hora de Colombia sale el resumen del día, antes de iniciar labores. */
const HORA_RESUMEN = 6;
const DIAS_AVISO_COORDINACION = 15;
const DIAS_AVISO_OFICIAL = 7;
const DIAS_RETENCION_AVISOS = 90;

const REQUISITOS: Record<Requisito, { nombre: string; vencido: string }> = {
  ARL: { nombre: 'la ARL', vencido: 'vencida' },
  SEGURIDAD_SOCIAL: { nombre: 'la planilla de seguridad social', vencido: 'vencida' },
  ALTURAS: { nombre: 'el certificado de alturas', vencido: 'vencido' },
};

/**
 * Tareas periódicas de la operación, cada hora:
 *  - vence los permisos que no iniciaron en su fecha, sin esperar a que
 *    alguien abra una pantalla;
 *  - envía una vez al día el resumen de vencimientos y jornadas sin cerrar;
 *  - depura la bandeja de avisos antiguos.
 *
 * La unicidad de `dedupeKey` garantiza un solo resumen por persona y día,
 * aunque corran varias instancias de la API.
 */
@Injectable()
export class NotificationDigestService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDigestService.name);
  private temporizador?: ReturnType<typeof setInterval>;
  private arranque?: ReturnType<typeof setTimeout>;
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly submissions: SubmissionsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get<string>('NOTIFICATIONS_DIGEST_ENABLED', 'true') === 'false') return;
    // Un minuto después de arrancar, para no competir con las migraciones y el healthcheck.
    this.arranque = setTimeout(() => void this.run(), 60_000);
    this.temporizador = setInterval(() => void this.run(), UNA_HORA_MS);
    this.arranque.unref();
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    clearTimeout(this.arranque);
    clearInterval(this.temporizador);
  }

  async run(now = new Date()): Promise<void> {
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.submissions.expireStalePermits();
      if (this.horaBogota(now) >= HORA_RESUMEN) await this.resumenDiario(now);
      await this.notifications.purgeOlderThan(DIAS_RETENCION_AVISOS);
    } catch (error) {
      this.logger.error('Falló la tarea periódica de avisos', error as Error);
    } finally {
      this.enCurso = false;
    }
  }

  async resumenDiario(now: Date): Promise<void> {
    const dia = businessDay(now);
    const activos = await this.prisma.collaborator.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, jobPosition: { select: { canLead: true } } },
    });

    const vencimientos = await this.compliance.vencimientos(
      activos.map((persona) => persona.id),
      DIAS_AVISO_COORDINACION,
      now,
    );
    const vencidos = vencimientos.filter((item) => item.estado === 'VENCIDO').length;
    const porVencer = vencimientos.length - vencidos;
    if (vencimientos.length) {
      await this.notifications.notify(await this.notifications.usuariosConPermiso('compliance:read'), {
        type: 'EXPIRATIONS_DIGEST',
        title: 'Requisitos por renovar',
        body: `${vencidos} ${vencidos === 1 ? 'requisito vencido' : 'requisitos vencidos'} y ${porVencer} por vencer en los próximos ${DIAS_AVISO_COORDINACION} días.`,
        link: '/coordinacion?pestana=vencimientos',
        dedupeKey: `digest:expirations:${dia}`,
      });
    }

    const sinCerrar = await this.prisma.formSubmission.count({
      where: { status: 'APPROVED', startedAt: { not: null }, workDate: { lt: businessDate(now) } },
    });
    if (sinCerrar) {
      await this.notifications.notify(await this.notifications.usuariosConPermiso('submissions:review'), {
        type: 'OVERDUE_WORKDAYS_DIGEST',
        title: 'Jornadas sin cerrar',
        body: `${sinCerrar} ${sinCerrar === 1 ? 'jornada de un día anterior sigue abierta' : 'jornadas de días anteriores siguen abiertas'}.`,
        link: '/coordinacion?pestana=jornadas',
        dedupeKey: `digest:overdue:${dia}`,
      });
    }

    // Cada oficial recibe sus propios vencimientos, con menos anticipación.
    const oficiales = new Set(activos.filter((persona) => persona.jobPosition?.canLead).map((persona) => persona.id));
    const propios = new Map<string, string[]>();
    for (const item of vencimientos) {
      if (!oficiales.has(item.collaboratorId)) continue;
      if (item.estado === 'POR_VENCER' && (item.diasRestantes ?? 0) > DIAS_AVISO_OFICIAL) continue;
      const { nombre, vencido } = REQUISITOS[item.requisito];
      const texto =
        item.estado === 'VENCIDO'
          ? `${nombre} está ${vencido}`
          : item.diasRestantes === 0
            ? `${nombre} vence hoy`
            : `${nombre} vence en ${item.diasRestantes} ${item.diasRestantes === 1 ? 'día' : 'días'}`;
      propios.set(item.collaboratorId, [...(propios.get(item.collaboratorId) ?? []), texto]);
    }
    for (const [collaboratorId, textos] of propios) {
      const frase = textos.join('; ');
      await this.notifications.notify([{ collaboratorId }], {
        type: 'OWN_EXPIRATIONS',
        title: 'Renueva tus requisitos',
        body: `${frase.charAt(0).toUpperCase()}${frase.slice(1)}. Avisa a tu coordinadora para no quedar fuera de la cuadrilla.`,
        link: '/formulario/alturas',
        dedupeKey: `digest:own:${dia}`,
      });
    }
  }

  private horaBogota(fecha: Date): number {
    return Number(
      new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: '2-digit', hourCycle: 'h23' }).format(fecha),
    );
  }
}
