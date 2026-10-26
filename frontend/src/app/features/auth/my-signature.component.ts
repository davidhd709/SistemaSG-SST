import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { destinoPorRoles, type PerfilInterno } from '../../core/destino';
import { fechaHora } from '../../core/fechas';

type FirmaRegistrada = { fullName: string | null; updatedAt: string | null; dataUrl: string | null };

/**
 * Nombre y firma que se registran una sola vez y que el sistema estampa en los
 * formatos que la persona aprueba (ATS y permiso eléctrico). Cambiarla solo
 * afecta las aprobaciones siguientes: las pasadas conservan la de su momento.
 */
@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <img class="sigla" src="assets/marca/marca-clara.png" alt="" width="40" height="40" /><span class="sello"
            >Gestión SST</span
          >
          <span class="nombre">Mi cuenta<span class="lema">Firma para aprobaciones</span></span>
        </div>
        <a class="boton secundario compacto" [routerLink]="volver()">Volver a mi área</a>
      </div>
    </header>
    <main class="app-contenido">
      <section class="area-masthead" aria-labelledby="firma-titulo">
        <div>
          <h1 id="firma-titulo">Mi firma</h1>
          <p>
            Se estampa, con tu nombre, en los formatos que apruebes y que la piden (ATS y permiso de riesgo eléctrico).
            Si la cambias, los formatos ya aprobados conservan la firma anterior.
          </p>
        </div>
      </section>

      @if (registrada(); as actual) {
        @if (actual.dataUrl) {
          <section class="bloque firma">
            <h2>Firma registrada</h2>
            <img class="vista" [src]="actual.dataUrl" alt="Firma registrada" />
            <p class="secundario">
              {{ actual.fullName }}
              @if (actual.updatedAt) {
                · registrada el {{ fecha(actual.updatedAt) }}
              }
            </p>
          </section>
        } @else {
          <p class="mensaje alerta firma" role="status">
            Aún no tienes firma registrada. Sin ella no puedes aprobar los formatos que la llevan.
          </p>
        }
      }

      <section class="bloque firma">
        <h2>{{ registrada()?.dataUrl ? 'Cambiar mi firma' : 'Registrar mi firma' }}</h2>
        <label class="campo">
          <span>Nombre completo, como debe aparecer en el formato</span>
          <input
            type="text"
            maxlength="120"
            autocomplete="name"
            [value]="nombre()"
            (input)="nombre.set($any($event.target).value)"
          />
        </label>
        <canvas
          #lienzo
          class="lienzo"
          [class.firmado]="hayFirma()"
          (pointerdown)="iniciarTrazo($event)"
          (pointermove)="trazar($event)"
          (pointerup)="terminarTrazo($event)"
          (pointercancel)="terminarTrazo($event)"
        ></canvas>
        <div class="acciones">
          <button class="boton secundario compacto" type="button" (click)="limpiar()" [disabled]="!hayFirma()">
            Borrar y firmar de nuevo
          </button>
        </div>
        @if (error()) {
          <p class="mensaje error" role="alert">{{ error() }}</p>
        }
        @if (aviso()) {
          <p class="mensaje ok" role="status">{{ aviso() }}</p>
        }
        <div class="acciones">
          <button
            class="boton"
            type="button"
            [disabled]="guardando() || !hayFirma() || nombre().trim().length < 3"
            (click)="guardar()"
          >
            {{ guardando() ? 'Guardando…' : 'Guardar firma' }}
          </button>
        </div>
      </section>
    </main>
  `,
  styles: [
    `
      .firma {
        max-width: 560px;
      }
      .vista {
        display: block;
        max-width: 100%;
        max-height: 140px;
        background: #fff;
        border: 1px solid var(--borde, #d0d5dd);
        border-radius: 8px;
      }
      .lienzo {
        display: block;
        width: 100%;
        height: 180px;
        margin-top: 12px;
        background: #fff;
        border: 2px dashed var(--borde, #d0d5dd);
        border-radius: 8px;
        touch-action: none;
      }
      .lienzo.firmado {
        border-style: solid;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MySignatureComponent {
  private readonly http = inject(HttpClient);
  @ViewChild('lienzo') lienzo?: ElementRef<HTMLCanvasElement>;

  readonly registrada = signal<FirmaRegistrada | null>(null);
  readonly nombre = signal('');
  readonly hayFirma = signal(false);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly volver = signal('/');
  private dibujando = false;

  constructor() {
    this.http.get<PerfilInterno>('/api/users/me').subscribe({
      next: (perfil) => this.volver.set(destinoPorRoles(perfil)),
    });
    this.cargar();
  }

  fecha(valor: string): string {
    return fechaHora(valor);
  }

  guardar(): void {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo || this.guardando() || !this.hayFirma()) return;
    this.guardando.set(true);
    this.error.set('');
    this.aviso.set('');
    this.http
      .put('/api/users/me/signature', { fullName: this.nombre().trim(), signatureDataUrl: this.sobreBlanco(lienzo) })
      .subscribe({
        next: () => {
          this.guardando.set(false);
          this.aviso.set('Firma guardada. Se usará en tus próximas aprobaciones.');
          this.limpiar();
          this.cargar();
        },
        error: (respuesta: HttpErrorResponse) => {
          const detalle = respuesta.error?.message;
          this.error.set(typeof detalle === 'string' ? detalle : 'No fue posible guardar la firma.');
          this.guardando.set(false);
        },
      });
  }

  iniciarTrazo(evento: PointerEvent): void {
    const lienzo = this.prepararLienzo();
    if (!lienzo) return;
    this.dibujando = true;
    lienzo.setPointerCapture(evento.pointerId);
    lienzo.getContext('2d')?.beginPath();
    this.trazar(evento);
  }

  trazar(evento: PointerEvent): void {
    if (!this.dibujando) return;
    const lienzo = this.lienzo?.nativeElement;
    const contexto = lienzo?.getContext('2d');
    if (!lienzo || !contexto) return;
    const marco = lienzo.getBoundingClientRect();
    const x = (evento.clientX - marco.left) * (lienzo.width / marco.width);
    const y = (evento.clientY - marco.top) * (lienzo.height / marco.height);
    contexto.lineWidth = 3.5;
    contexto.lineCap = 'round';
    contexto.lineJoin = 'round';
    contexto.strokeStyle = '#111827';
    contexto.lineTo(x, y);
    contexto.stroke();
    contexto.beginPath();
    contexto.moveTo(x, y);
    this.hayFirma.set(true);
  }

  terminarTrazo(evento: PointerEvent): void {
    this.dibujando = false;
    const lienzo = this.lienzo?.nativeElement;
    lienzo?.getContext('2d')?.beginPath();
    if (lienzo?.hasPointerCapture(evento.pointerId)) lienzo.releasePointerCapture(evento.pointerId);
  }

  limpiar(): void {
    const lienzo = this.lienzo?.nativeElement;
    lienzo?.getContext('2d')?.clearRect(0, 0, lienzo.width, lienzo.height);
    this.hayFirma.set(false);
  }

  private cargar(): void {
    this.http.get<FirmaRegistrada>('/api/users/me/signature').subscribe({
      next: (firma) => {
        this.registrada.set(firma);
        if (!this.nombre() && firma.fullName) this.nombre.set(firma.fullName);
      },
      error: () => this.error.set('No fue posible consultar tu firma registrada.'),
    });
  }

  /** Ajusta el búfer del lienzo al tamaño real en pantalla antes del primer trazo. */
  private prepararLienzo(): HTMLCanvasElement | null {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo) return null;
    const marco = lienzo.getBoundingClientRect();
    const escala = Math.min(globalThis.devicePixelRatio || 1, 2);
    const ancho = Math.round(marco.width * escala);
    const alto = Math.round(marco.height * escala);
    if (!this.hayFirma() && (lienzo.width !== ancho || lienzo.height !== alto)) {
      lienzo.width = ancho;
      lienzo.height = alto;
    }
    return lienzo;
  }

  /** El PDF va sobre papel blanco: sin fondo la firma transparente se pierde al imprimir. */
  private sobreBlanco(lienzo: HTMLCanvasElement): string {
    const plano = document.createElement('canvas');
    plano.width = lienzo.width;
    plano.height = lienzo.height;
    const contexto = plano.getContext('2d');
    if (!contexto) return lienzo.toDataURL('image/png');
    contexto.fillStyle = '#ffffff';
    contexto.fillRect(0, 0, plano.width, plano.height);
    contexto.drawImage(lienzo, 0, 0);
    return plano.toDataURL('image/png');
  }
}
