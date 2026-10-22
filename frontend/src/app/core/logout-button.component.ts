import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { AuthSessionService } from './auth-session.service';
import { RouterLink } from '@angular/router';
import { NotificationBellComponent } from './notification-bell.component';
import { NotificationsClientService } from './notifications.service';

/**
 * Acciones de la cuenta en la cabecera. El equipo interno las encuentra en un
 * menú "Mi cuenta" (cambiar contraseña y cerrar sesión) para que no compitan
 * con las acciones de cada área; el colaborador solo necesita salir.
 */
@Component({
  selector: 'sg-logout-button',
  imports: [RouterLink, NotificationBellComponent],
  host: {
    '(document:click)': 'cerrarSiFuera($event)',
    '(document:keydown.escape)': 'abierto.set(false)',
  },
  template: `
    @if (session.isAuthenticated()) {
      <sg-notification-bell />
      @if (session.kind() === 'ADMIN') {
        <div class="cuenta">
          <button
            type="button"
            class="boton secundario compacto"
            aria-haspopup="menu"
            [attr.aria-expanded]="abierto()"
            aria-controls="menu-cuenta"
            (click)="abierto.set(!abierto())"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.9-3.4 3.6-5.5 7-5.5s6.1 2.1 7 5.5" />
            </svg>
            Mi cuenta
            <svg class="flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
          </button>
          @if (abierto()) {
            <div id="menu-cuenta" class="menu" role="menu">
              <a role="menuitem" routerLink="/administracion/mi-contrasena" (click)="abierto.set(false)">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="9" rx="2" />
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                </svg>
                Cambiar contraseña
              </a>
              <button role="menuitem" type="button" (click)="cerrarSesion()">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10" />
                </svg>
                Cerrar sesión
              </button>
            </div>
          }
        </div>
      } @else {
        <button type="button" class="boton secundario compacto" (click)="cerrarSesion()">Cerrar sesión</button>
      }
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .cuenta {
        position: relative;
      }
      .boton svg {
        width: 18px;
        height: 18px;
      }
      .boton .flecha {
        width: 16px;
        height: 16px;
        margin-left: -2px;
        transition: transform 200ms var(--curva);
      }
      .boton[aria-expanded='true'] .flecha {
        transform: rotate(180deg);
      }
      .menu {
        position: absolute;
        z-index: 20;
        top: calc(100% + 8px);
        right: 0;
        display: grid;
        min-width: 220px;
        padding: 6px;
        border: 1px solid var(--borde);
        border-radius: 14px;
        background: var(--superficie);
        box-shadow: var(--sombra-alta);
        animation: subir 300ms var(--curva) both;
      }
      .menu a,
      .menu button {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 8px 12px;
        border: 0;
        border-radius: 10px;
        background: none;
        color: var(--tinta);
        font: inherit;
        font-family: var(--letra-marca);
        font-size: 0.875rem;
        font-weight: 600;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
      }
      .menu a:hover,
      .menu button:hover {
        background: var(--fondo);
        color: var(--marino);
      }
      .menu :focus-visible {
        outline-color: var(--azul);
        outline-offset: -2px;
      }
      .menu svg {
        flex: none;
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .menu button {
        margin-top: 4px;
        border-top: 1px solid #e6ebf0;
        border-radius: 0 0 10px 10px;
        color: var(--error);
      }
      .menu button:hover {
        background: var(--error-fondo);
        color: var(--error);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoutButtonComponent {
  readonly session = inject(AuthSessionService);
  readonly abierto = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly avisos = inject(NotificationsClientService);

  /** Desvincula el push de este dispositivo antes de salir: en obra se comparte. */
  cerrarSesion(): void {
    this.abierto.set(false);
    void this.avisos.cerrarSesion();
  }

  cerrarSiFuera(evento: MouseEvent): void {
    if (this.abierto() && !this.host.nativeElement.contains(evento.target as Node)) this.abierto.set(false);
  }
}
