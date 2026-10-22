import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';

/**
 * Servicios de push de los navegadores. El servidor hace una petición HTTP al
 * endpoint que entrega el navegador, así que solo se aceptan estos dominios:
 * un endpoint arbitrario convertiría la API en un proxy hacia la red interna.
 */
const DOMINIOS_PUSH = [
  /^fcm\.googleapis\.com$/,
  /^(updates\.)?push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
];

export type ResultadoPush = 'ENVIADO' | 'VENCIDA' | 'FALLO';

export type SuscripcionPush = { endpoint: string; p256dh: string; auth: string };

export function esEndpointPushPermitido(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && DOMINIOS_PUSH.some((dominio) => dominio.test(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Envío Web Push con llaves VAPID. Es opcional: sin `VAPID_PUBLIC_KEY` y
 * `VAPID_PRIVATE_KEY` los avisos quedan solo en la bandeja de la aplicación.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  readonly publicKey: string | null;

  constructor(config: ConfigService) {
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY')?.trim();
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY')?.trim();
    const subject = config.get<string>('VAPID_SUBJECT')?.trim() || 'mailto:sst@localhost';
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKey = publicKey;
    } else {
      this.publicKey = null;
    }
  }

  get enabled(): boolean {
    return this.publicKey !== null;
  }

  async send(suscripcion: SuscripcionPush, payload: object): Promise<ResultadoPush> {
    if (!this.enabled || !esEndpointPushPermitido(suscripcion.endpoint)) return 'FALLO';
    try {
      await webpush.sendNotification(
        { endpoint: suscripcion.endpoint, keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 12, timeout: 10_000, urgency: 'normal' },
      );
      return 'ENVIADO';
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // 404 y 410: el navegador anuló la suscripción y no volverá a servir.
      if (status === 404 || status === 410) return 'VENCIDA';
      this.logger.warn(`No fue posible enviar una notificación push (estado ${status ?? 'sin respuesta'}).`);
      return 'FALLO';
    }
  }
}
