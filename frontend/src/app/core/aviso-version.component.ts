import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';

/** Cada cuánto se pregunta al servidor si hay un despliegue nuevo. */
const INTERVALO_REVISION_MS = 15 * 60 * 1000;

/**
 * Aviso de versión nueva.
 *
 * La PWA guarda la aplicación en el dispositivo: tras un despliegue, el
 * navegador sigue mostrando la copia anterior hasta la siguiente carga. Este
 * aviso lo hace visible y deja actualizar con un toque. Nunca recarga solo: un
 * colaborador puede estar diligenciando o firmando un permiso.
 */
@Component({
  selector: 'sg-aviso-version',
  template: `
    @if (disponible()) {
      <div class="aviso" role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5" />
        </svg>
        <span>Hay una versión nueva de Gestión SST.</span>
        <button class="boton compacto" type="button" (click)="actualizar()">Actualizar</button>
        <button class="cerrar" type="button" aria-label="Recordarme más tarde" (click)="disponible.set(false)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    }
  `,
  styles: [
    `
      .aviso {
        position: fixed;
        z-index: 50;
        top: 12px;
        left: 50%;
        display: flex;
        align-items: center;
        gap: 10px;
        width: max-content;
        max-width: calc(100% - 24px);
        padding: 8px 8px 8px 14px;
        border: 1px solid rgb(255 255 255 / 0.14);
        border-radius: 14px;
        background: var(--marino-950);
        color: #fff;
        font-size: 0.9375rem;
        font-weight: 500;
        box-shadow: var(--sombra-alta);
        transform: translateX(-50%);
        animation: subir 400ms var(--curva) both;
      }
      .aviso > svg,
      .cerrar svg {
        flex: none;
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .aviso > svg {
        color: var(--teal-claro);
      }
      .aviso .boton {
        flex: none;
        min-height: 38px;
      }
      .cerrar {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        border: 0;
        border-radius: 10px;
        background: none;
        color: #c3d3e3;
        cursor: pointer;
      }
      .cerrar:hover {
        background: rgb(255 255 255 / 0.1);
        color: #fff;
      }
      .aviso :focus-visible {
        outline-color: var(--teal-claro);
      }
      @media (max-width: 480px) {
        .aviso span {
          font-size: 0.875rem;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AvisoVersionComponent {
  private readonly sw = inject(SwUpdate, { optional: true });
  readonly disponible = signal(false);

  constructor() {
    const sw = this.sw;
    if (!sw?.isEnabled) return;

    const suscripcion = sw.versionUpdates.subscribe((evento) => {
      if (evento.type === 'VERSION_READY') this.disponible.set(true);
    });
    // Si la copia guardada quedó inservible, solo una recarga la recupera.
    const irrecuperable = sw.unrecoverable.subscribe(() => document.location.reload());

    const revisar = () => void sw.checkForUpdate().catch(() => undefined);
    const alVolver = () => {
      if (document.visibilityState === 'visible') revisar();
    };
    revisar();
    const intervalo = setInterval(revisar, INTERVALO_REVISION_MS);
    document.addEventListener('visibilitychange', alVolver);

    inject(DestroyRef).onDestroy(() => {
      suscripcion.unsubscribe();
      irrecuperable.unsubscribe();
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolver);
    });
  }

  actualizar(): void {
    void this.sw
      ?.activateUpdate()
      .catch(() => undefined)
      .finally(() => document.location.reload());
  }
}
