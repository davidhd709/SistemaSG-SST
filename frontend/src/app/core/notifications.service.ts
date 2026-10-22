import { DestroyRef, Injectable, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { Observable, catchError, firstValueFrom, of } from 'rxjs';
import { AuthSessionService } from './auth-session.service';

export type Aviso = {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

/** Cada minuto basta: los avisos urgentes también llegan por push. */
const INTERVALO_MS = 60_000;

/**
 * Bandeja de avisos de la persona con sesión y su suscripción push en este
 * dispositivo. El contador se consulta solo con la pestaña visible.
 */
@Injectable({ providedIn: 'root' })
export class NotificationsClientService {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly swPush = inject(SwPush);

  readonly unread = signal(0);
  readonly items = signal<Aviso[]>([]);
  readonly cargando = signal(false);
  /** Llave VAPID del servidor; `null` si el push no está configurado. */
  readonly publicKey = signal<string | null>(null);
  readonly suscrito = signal(false);

  private temporizador?: ReturnType<typeof setInterval>;

  constructor() {
    // Empieza y se detiene con la sesión: sin sesión no hay bandeja que consultar.
    effect(() => {
      clearInterval(this.temporizador);
      if (!this.session.isAuthenticated()) {
        this.unread.set(0);
        this.items.set([]);
        return;
      }
      this.actualizarContador();
      this.temporizador = setInterval(() => {
        if (document.visibilityState === 'visible') this.actualizarContador();
      }, INTERVALO_MS);
    });
    inject(DestroyRef).onDestroy(() => clearInterval(this.temporizador));
    if (this.swPush.isEnabled) this.swPush.subscription.subscribe((actual) => this.suscrito.set(!!actual));
  }

  /** El navegador admite push y el servidor lo tiene configurado. */
  get pushDisponible(): boolean {
    return this.swPush.isEnabled && 'Notification' in globalThis && this.publicKey() !== null;
  }

  get pushBloqueado(): boolean {
    return 'Notification' in globalThis && Notification.permission === 'denied';
  }

  actualizarContador(): void {
    this.http
      .get<{ unread: number }>('/api/notifications/unread-count')
      .pipe(catchError(() => of(null)))
      .subscribe((respuesta) => respuesta && this.unread.set(respuesta.unread));
  }

  cargar(): void {
    this.cargando.set(true);
    this.http
      .get<{ items: Aviso[]; unread: number }>('/api/notifications', { params: { take: 20 } })
      .pipe(catchError(() => of(null)))
      .subscribe((respuesta) => {
        this.cargando.set(false);
        if (!respuesta) return;
        this.items.set(respuesta.items);
        this.unread.set(respuesta.unread);
      });
    if (this.publicKey() === null && this.swPush.isEnabled) {
      this.http
        .get<{ publicKey: string | null }>('/api/notifications/push/public-key')
        .pipe(catchError(() => of({ publicKey: null })))
        .subscribe(({ publicKey }) => this.publicKey.set(publicKey));
    }
  }

  marcarLeido(aviso: Aviso): Observable<unknown> {
    if (aviso.readAt) return of(null);
    this.items.update((lista) =>
      lista.map((otro) => (otro.id === aviso.id ? { ...otro, readAt: new Date().toISOString() } : otro)),
    );
    this.unread.update((total) => Math.max(0, total - 1));
    return this.http.post(`/api/notifications/${aviso.id}/read`, {}).pipe(catchError(() => of(null)));
  }

  marcarTodo(): void {
    this.items.update((lista) =>
      lista.map((aviso) => ({ ...aviso, readAt: aviso.readAt ?? new Date().toISOString() })),
    );
    this.unread.set(0);
    this.http
      .post('/api/notifications/read-all', {})
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  /** Pide permiso al navegador y registra este dispositivo para recibir avisos. */
  async activarPush(): Promise<void> {
    const serverPublicKey = this.publicKey();
    if (!serverPublicKey || !this.swPush.isEnabled) throw new Error('Push no disponible');
    const suscripcion = await this.swPush.requestSubscription({ serverPublicKey });
    const { endpoint, keys } = suscripcion.toJSON();
    await firstValueFrom(this.http.post('/api/notifications/push/subscriptions', { endpoint, keys }));
    this.suscrito.set(true);
  }

  /**
   * Desvincula este dispositivo. Se hace al cerrar sesión: en obra un celular
   * se comparte y no debe seguir mostrando los avisos de quien salió.
   */
  async desactivarPush(): Promise<void> {
    if (!this.swPush.isEnabled) return;
    const actual = await firstValueFrom(this.swPush.subscription);
    if (!actual) return;
    await firstValueFrom(
      this.http
        .delete('/api/notifications/push/subscriptions', { body: { endpoint: actual.endpoint } })
        .pipe(catchError(() => of(null))),
    );
    await this.swPush.unsubscribe().catch(() => undefined);
    this.suscrito.set(false);
  }

  /** Cierra la sesión después de desvincular el dispositivo, sin bloquearse si falla. */
  async cerrarSesion(): Promise<void> {
    await this.desactivarPush().catch(() => undefined);
    this.session.logout();
  }
}
