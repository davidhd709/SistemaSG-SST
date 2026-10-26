import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthPrincipal, AuthenticatedRequest } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { esEndpointPushPermitido, PushService } from './push.service';
import type { PushSubscriptionDto } from './dto/push-subscription.dto';

export type Destinatario = { userId: string } | { collaboratorId: string };

export type Aviso = {
  type: string;
  title: string;
  body: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Identifica un aviso que no debe repetirse; se combina con el destinatario. */
  dedupeKey?: string;
};

/** Tras tantos fallos seguidos se descarta la suscripción del dispositivo. */
const MAX_FALLOS_PUSH = 5;

/**
 * Bandeja de avisos. Registrar un aviso nunca debe tumbar la operación que lo
 * origina: los errores se registran en el log y la operación sigue.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  // ── Emisión ──────────────────────────────────────────────────────────
  async notify(destinatarios: Destinatario[], aviso: Aviso): Promise<void> {
    if (!destinatarios.length) return;
    try {
      const filas = destinatarios.map((destinatario) => ({
        ...this.columnasDestinatario(destinatario),
        type: aviso.type,
        title: aviso.title,
        body: aviso.body,
        link: aviso.link,
        entityType: aviso.entityType,
        entityId: aviso.entityId,
        dedupeKey: aviso.dedupeKey ? `${aviso.dedupeKey}:${this.clave(destinatario)}` : undefined,
      }));
      // `skipDuplicates` respeta la unicidad de `dedupeKey`: un resumen diario
      // ya enviado a esa persona no se vuelve a crear.
      const creados = await this.prisma.notification.createManyAndReturn({
        data: filas,
        skipDuplicates: true,
        select: { recipientUserId: true, recipientCollaboratorId: true },
      });
      if (creados.length) await this.enviarPush(creados, aviso);
    } catch (error) {
      this.logger.error(`No fue posible registrar el aviso ${aviso.type}`, error as Error);
    }
  }

  /** Avisa a todos los usuarios internos activos que tienen un permiso. */
  async notifyPermission(permiso: string, aviso: Aviso): Promise<void> {
    try {
      await this.notify(await this.usuariosConPermiso(permiso), aviso);
    } catch (error) {
      this.logger.error(`No fue posible avisar a quienes tienen ${permiso}`, error as Error);
    }
  }

  /** Usuarios internos activos con un permiso dado, para avisos de su área. */
  async usuariosConPermiso(permiso: string): Promise<Destinatario[]> {
    const usuarios = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        roles: { some: { role: { permissions: { some: { permission: { code: permiso } } } } } },
      },
      select: { id: true },
    });
    return usuarios.map((usuario) => ({ userId: usuario.id }));
  }

  // ── Bandeja ──────────────────────────────────────────────────────────
  async list(principal: AuthPrincipal | undefined, unreadOnly: boolean, take: number) {
    const where: Prisma.NotificationWhereInput = {
      ...this.filtroPropio(principal),
      ...(unreadOnly ? { readAt: null } : {}),
    };
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        select: { id: true, type: true, title: true, body: true, link: true, readAt: true, createdAt: true },
      }),
      this.prisma.notification.count({ where: { ...this.filtroPropio(principal), readAt: null } }),
    ]);
    return { items, unread };
  }

  async unreadCount(principal: AuthPrincipal | undefined) {
    return {
      unread: await this.prisma.notification.count({ where: { ...this.filtroPropio(principal), readAt: null } }),
    };
  }

  async markRead(principal: AuthPrincipal | undefined, id: string) {
    // El filtro por destinatario impide marcar avisos ajenos.
    const { count } = await this.prisma.notification.updateMany({
      where: { id, ...this.filtroPropio(principal), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  async markAllRead(principal: AuthPrincipal | undefined) {
    const { count } = await this.prisma.notification.updateMany({
      where: { ...this.filtroPropio(principal), readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }

  // ── Suscripciones push ───────────────────────────────────────────────
  pushPublicKey() {
    return { publicKey: this.push.publicKey };
  }

  async subscribe(request: AuthenticatedRequest, dto: PushSubscriptionDto) {
    if (!this.push.enabled) throw new BadRequestException('Las notificaciones push no están configuradas.');
    if (!esEndpointPushPermitido(dto.endpoint)) {
      throw new BadRequestException('El servicio de notificaciones de este navegador no está admitido.');
    }
    const dueno = this.columnasDestinatario(this.destinatario(request.principal));
    // Un dispositivo compartido en obra pasa al último colaborador que lo activó.
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId: dueno.recipientUserId ?? null,
        collaboratorId: dueno.recipientCollaboratorId ?? null,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: request.header('user-agent')?.slice(0, 300),
        failures: 0,
      },
      create: {
        endpoint: dto.endpoint,
        userId: dueno.recipientUserId,
        collaboratorId: dueno.recipientCollaboratorId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: request.header('user-agent')?.slice(0, 300),
      },
    });
    return { subscribed: true };
  }

  async unsubscribe(principal: AuthPrincipal | undefined, endpoint: string) {
    const dueno = this.columnasDestinatario(this.destinatario(principal));
    const { count } = await this.prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        ...(dueno.recipientUserId
          ? { userId: dueno.recipientUserId }
          : { collaboratorId: dueno.recipientCollaboratorId }),
      },
    });
    return { removed: count };
  }

  /** Borra avisos con más de `dias` de antigüedad: la bandeja no es un archivo documental. */
  async purgeOlderThan(dias: number): Promise<number> {
    const limite = new Date(Date.now() - dias * 86_400_000);
    const { count } = await this.prisma.notification.deleteMany({ where: { createdAt: { lt: limite } } });
    return count;
  }

  // ── Interno ──────────────────────────────────────────────────────────
  private async enviarPush(
    destinatarios: { recipientUserId: string | null; recipientCollaboratorId: string | null }[],
    aviso: Aviso,
  ): Promise<void> {
    if (!this.push.enabled) return;
    const userIds = destinatarios.map((item) => item.recipientUserId).filter((id): id is string => !!id);
    const collaboratorIds = destinatarios
      .map((item) => item.recipientCollaboratorId)
      .filter((id): id is string => !!id);
    const suscripciones = await this.prisma.pushSubscription.findMany({
      where: { OR: [{ userId: { in: userIds } }, { collaboratorId: { in: collaboratorIds } }] },
    });
    // Formato que entiende el service worker de Angular: muestra el aviso y
    // al tocarlo abre (o enfoca) la aplicación en la ruta indicada.
    const payload = {
      notification: {
        title: aviso.title,
        body: aviso.body,
        icon: '/assets/marca/icono-192.png',
        badge: '/assets/marca/icono-192.png',
        tag: aviso.type,
        data: {
          onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: aviso.link ?? '/' } },
        },
      },
    };
    await Promise.all(
      suscripciones.map(async (suscripcion) => {
        const resultado = await this.push.send(suscripcion, payload);
        if (resultado === 'ENVIADO') {
          await this.prisma.pushSubscription.update({
            where: { id: suscripcion.id },
            data: { failures: 0, lastSuccessAt: new Date() },
          });
        } else if (resultado === 'VENCIDA' || suscripcion.failures + 1 >= MAX_FALLOS_PUSH) {
          await this.prisma.pushSubscription.deleteMany({ where: { id: suscripcion.id } });
        } else {
          await this.prisma.pushSubscription.update({
            where: { id: suscripcion.id },
            data: { failures: { increment: 1 } },
          });
        }
      }),
    );
  }

  private destinatario(principal: AuthPrincipal | undefined): Destinatario {
    if (principal?.kind === 'USER') return { userId: principal.userId };
    if (principal?.kind === 'COLLABORATOR') return { collaboratorId: principal.collaboratorId };
    throw new ForbiddenException();
  }

  private filtroPropio(principal: AuthPrincipal | undefined): Prisma.NotificationWhereInput {
    const destinatario = this.destinatario(principal);
    return 'userId' in destinatario
      ? { recipientUserId: destinatario.userId }
      : { recipientCollaboratorId: destinatario.collaboratorId };
  }

  private columnasDestinatario(destinatario: Destinatario) {
    return 'userId' in destinatario
      ? { recipientUserId: destinatario.userId, recipientCollaboratorId: undefined }
      : { recipientUserId: undefined, recipientCollaboratorId: destinatario.collaboratorId };
  }

  private clave(destinatario: Destinatario): string {
    return 'userId' in destinatario ? `u:${destinatario.userId}` : `c:${destinatario.collaboratorId}`;
  }
}
