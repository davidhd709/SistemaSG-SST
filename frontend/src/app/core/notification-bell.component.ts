import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { fechaHora } from './fechas';
import { NotificationsClientService, type Aviso } from './notifications.service';

/** Campana de avisos de la cabecera, con su contador y la activación push. */
@Component({
  selector: 'sg-notification-bell',
  host: {
    '(document:click)': 'cerrarSiFuera($event)',
    '(document:keydown.escape)': 'abierto.set(false)',
  },
  template: `
    <div class="avisos">
      <button
        type="button"
        class="boton secundario compacto campana"
        aria-haspopup="dialog"
        [attr.aria-expanded]="abierto()"
        aria-controls="panel-avisos"
        [attr.aria-label]="avisos.unread() ? 'Avisos: ' + avisos.unread() + ' sin leer' : 'Avisos'"
        (click)="alternar()"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
        @if (avisos.unread()) {
          <span class="globo">{{ avisos.unread() > 99 ? '99+' : avisos.unread() }}</span>
        }
      </button>

      @if (abierto()) {
        <div id="panel-avisos" class="panel" role="dialog" aria-label="Avisos">
          <div class="panel-cabecera">
            <strong>Avisos</strong>
            @if (avisos.unread()) {
              <button type="button" class="enlace" (click)="avisos.marcarTodo()">Marcar todo como leído</button>
            }
          </div>

          @if (avisos.pushDisponible && !avisos.suscrito()) {
            <div class="push">
              @if (avisos.pushBloqueado) {
                <p>Las notificaciones están bloqueadas en este navegador. Actívalas en su configuración.</p>
              } @else {
                <p>Recibe estos avisos en este dispositivo aunque la aplicación esté cerrada.</p>
                <button class="boton compacto" type="button" [disabled]="activando()" (click)="activarPush()">
                  {{ activando() ? 'Activando…' : 'Activar notificaciones' }}
                </button>
              }
              @if (errorPush()) {
                <p class="error" role="alert">{{ errorPush() }}</p>
              }
            </div>
          }

          @if (avisos.items().length) {
            <ul>
              @for (aviso of avisos.items(); track aviso.id) {
                <li>
                  <button type="button" [class.no-leido]="!aviso.readAt" (click)="abrir(aviso)">
                    <strong>{{ aviso.title }}</strong>
                    <span>{{ aviso.body }}</span>
                    <small>{{ fecha(aviso.createdAt) }}</small>
                  </button>
                </li>
              }
            </ul>
          } @else if (avisos.cargando()) {
            <p class="vacio-panel">Consultando…</p>
          } @else {
            <p class="vacio-panel">No tienes avisos.</p>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .avisos {
        position: relative;
      }
      .campana {
        position: relative;
      }
      .campana svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .campana .globo {
        position: absolute;
        top: -7px;
        right: -7px;
        display: inline-grid;
        place-items: center;
        min-width: 20px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: var(--error);
        color: #fff;
        font-size: 0.6875rem;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .panel {
        position: absolute;
        right: 0;
        top: calc(100% + 8px);
        z-index: 30;
        width: min(360px, calc(100vw - 32px));
        max-height: min(70vh, 520px);
        overflow-y: auto;
        background: var(--superficie);
        color: var(--tinta);
        border: 1px solid var(--borde);
        border-radius: 14px;
        box-shadow: var(--sombra-alta);
        text-align: left;
      }
      .panel-cabecera {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--borde);
      }
      .enlace {
        border: 0;
        background: none;
        color: var(--azul);
        font: inherit;
        font-size: 0.8125rem;
        cursor: pointer;
        padding: 4px;
      }
      .push {
        padding: 12px 14px;
        border-bottom: 1px solid var(--borde);
        font-size: 0.875rem;
      }
      .push p {
        margin: 0 0 8px;
      }
      .push .error {
        color: var(--error);
        margin: 8px 0 0;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li + li {
        border-top: 1px solid var(--borde);
      }
      li button {
        display: grid;
        gap: 2px;
        width: 100%;
        padding: 12px 14px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      li button:hover,
      li button:focus-visible {
        background: var(--fondo);
      }
      li button.no-leido {
        box-shadow: inset 3px 0 0 var(--azul);
      }
      li button.no-leido strong::after {
        content: ' ·';
        color: var(--azul);
      }
      li span {
        font-size: 0.875rem;
        color: var(--tinta-media);
      }
      li small {
        font-size: 0.75rem;
        color: var(--tinta-suave);
      }
      .vacio-panel {
        margin: 0;
        padding: 20px 14px;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent {
  readonly avisos = inject(NotificationsClientService);
  private readonly router = inject(Router);
  private readonly elemento = inject(ElementRef<HTMLElement>);

  readonly abierto = signal(false);
  readonly activando = signal(false);
  readonly errorPush = signal('');

  alternar(): void {
    this.abierto.update((abierto) => !abierto);
    if (this.abierto()) this.avisos.cargar();
  }

  abrir(aviso: Aviso): void {
    this.avisos.marcarLeido(aviso).subscribe();
    this.abierto.set(false);
    if (aviso.link?.startsWith('/')) void this.router.navigateByUrl(aviso.link);
  }

  async activarPush(): Promise<void> {
    this.activando.set(true);
    this.errorPush.set('');
    try {
      await this.avisos.activarPush();
    } catch {
      this.errorPush.set('No fue posible activar las notificaciones en este dispositivo.');
    } finally {
      this.activando.set(false);
    }
  }

  fecha(valor: string): string {
    return fechaHora(valor);
  }

  cerrarSiFuera(evento: MouseEvent): void {
    if (this.abierto() && !this.elemento.nativeElement.contains(evento.target as Node)) this.abierto.set(false);
  }
}
