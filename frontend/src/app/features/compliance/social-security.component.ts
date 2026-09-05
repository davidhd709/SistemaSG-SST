import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { fechaCalendario } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';

type Persona = { id: string; firstName: string; lastName: string; documentNumber: string };
type FilaCumplimiento = { collaborator: Persona; cumplimiento: { seguridadSocial: { estado: string } } };
type Planilla = {
  id: string;
  reference: string;
  providerName: string | null;
  periodStart: string;
  periodEnd: string;
  file: { id: string; originalName: string } | null;
  members: Pick<Persona, 'id' | 'firstName' | 'lastName'>[];
};

@Component({
  imports: [ReactiveFormsModule, RouterLink, RouterLinkActive, LogoutButtonComponent],
  template: ` <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <span class="sigla" aria-hidden="true">SST</span
          ><span class="nombre">Gestión de requisitos<span class="lema">ARL y seguridad social</span></span>
        </div>
        <sg-logout-button />
      </div>
    </header>
    <main class="app-contenido">
      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      @if (aviso()) {
        <p class="mensaje ok" role="status">{{ aviso() }}</p>
      }

      <section class="area-masthead" aria-labelledby="social-titulo">
        <div>
          <h1 id="social-titulo">Seguridad social</h1>
          <p>Registra las planillas y su cobertura. Este requisito se administra por separado de la afiliación ARL.</p>
        </div>
        <span class="area-contexto">Gestor ARL</span>
      </section>
      <nav class="modulos" aria-label="Gestión de requisitos">
        <a routerLink="/gestor-arl">ARL</a>
        <a routerLink="/seguridad-social" routerLinkActive="activo">Seguridad social</a>
      </nav>

      <section class="bloque">
        <div class="titulo-seccion">
          <h2>Registrar planilla</h2>
          <button class="boton secundario compacto" type="button" (click)="cargar()">Actualizar</button>
        </div>
        <p class="secundario introduccion">
          Selecciona las personas cubiertas durante el periodo. Si cambia el grupo, registra una nueva planilla para esa
          cobertura.
        </p>
        <form [formGroup]="formulario" (ngSubmit)="guardar()" class="rejilla-campos dos">
          <label class="campo"
            ><span>Referencia de la planilla</span
            ><input formControlName="reference" autocomplete="off" placeholder="Por ejemplo, PILA-2026-09"
          /></label>
          <label class="campo"
            ><span>Operador</span><input formControlName="providerName" autocomplete="off" placeholder="Opcional"
          /></label>
          <label class="campo"
            ><span>Inicio del periodo</span><input type="date" formControlName="periodStart"
          /></label>
          <label class="campo"><span>Fin del periodo</span><input type="date" formControlName="periodEnd" /></label>
          @if (rangoInvalido()) {
            <p class="mensaje error ancho-total">La fecha de fin debe ser igual o posterior a la de inicio.</p>
          }
          <div class="campo ancho-total">
            <span id="personas-cubiertas">Personas cubiertas</span>
            <div class="casillas" role="group" aria-labelledby="personas-cubiertas">
              @for (fila of filas(); track fila.collaborator.id) {
                <label class="casilla"
                  ><input
                    type="checkbox"
                    [checked]="estaCubierto(fila.collaborator.id)"
                    (change)="alternar(fila.collaborator.id)"
                  /><span
                    >{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}
                    <small>{{ fila.collaborator.documentNumber }}</small></span
                  ></label
                >
              }
            </div>
          </div>
          <div class="acciones ancho-total">
            <button
              class="boton"
              [disabled]="formulario.invalid || rangoInvalido() || !cubiertos().length || guardando()"
            >
              {{ guardando() ? 'Registrando…' : 'Registrar planilla' }}
            </button>
          </div>
        </form>
      </section>

      <section class="bloque">
        <div class="titulo-seccion">
          <h2>
            Planillas registradas <span class="conteo">({{ planillas().length }})</span>
          </h2>
        </div>
        @if (cargando()) {
          <p class="secundario">Consultando planillas…</p>
        } @else if (planillas().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Periodo</th>
                  <th>Cubre</th>
                  <th>Soporte</th>
                </tr>
              </thead>
              <tbody>
                @for (planilla of planillas(); track planilla.id) {
                  <tr>
                    <td>
                      <strong>{{ planilla.reference }}</strong>
                      @if (planilla.providerName) {
                        <span class="secundario">{{ planilla.providerName }}</span>
                      }
                    </td>
                    <td>
                      {{ fecha(planilla.periodStart)
                      }}<span class="secundario">hasta {{ fecha(planilla.periodEnd) }}</span>
                    </td>
                    <td>{{ planilla.members.length }} personas</td>
                    <td>
                      @if (planilla.file) {
                        <button class="boton secundario compacto" type="button" (click)="descargar(planilla.file)">
                          Ver soporte
                        </button>
                      } @else {
                        <span class="secundario">Sin soporte</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="vacio">
            <strong>Aún no hay planillas registradas</strong>Registra la primera cobertura de seguridad social.
          </p>
        }
      </section>
    </main>`,
  styles: [
    `
      .area-masthead {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        margin: 0 0 28px;
        padding: 21px 24px;
        border-radius: 16px;
        background: #efeee8;
      }
      .area-masthead h1 {
        margin: 0 0 4px;
        font-size: clamp(1.45rem, 2.6vw, 2rem);
        letter-spacing: -0.03em;
      }
      .area-masthead p {
        max-width: 65ch;
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .area-contexto {
        padding: 6px 10px;
        border-radius: 999px;
        background: #dceee5;
        color: #245d4c;
        font-size: 0.75rem;
        font-weight: 750;
        white-space: nowrap;
      }
      .modulos {
        display: flex;
        gap: 8px;
        margin: -12px 0 28px;
      }
      .modulos a {
        min-height: 42px;
        padding: 10px 14px;
        border-radius: 10px;
        color: var(--tinta-media);
        font-weight: 700;
        text-decoration: none;
      }
      .modulos a:hover,
      .modulos a:focus-visible {
        background: #e5eee8;
        color: #245d4c;
      }
      .modulos a.activo {
        background: #245d4c;
        color: #fff;
      }
      .introduccion {
        margin: -4px 0 18px;
      }
      .casillas {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 8px;
        margin-top: 8px;
      }
      .casilla {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        padding: 8px 10px;
        border: 1px solid var(--borde);
        border-radius: 10px;
        cursor: pointer;
      }
      .casilla small {
        color: var(--tinta-suave);
      }
      .casilla input {
        width: 18px;
        height: 18px;
      }
      .bloque + .bloque {
        margin-top: 24px;
      }
      @media (max-width: 640px) {
        .area-masthead {
          align-items: start;
          flex-direction: column;
          padding: 18px 16px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SocialSecurityComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly filas = signal<FilaCumplimiento[]>([]);
  readonly planillas = signal<Planilla[]>([]);
  readonly cubiertos = signal<string[]>([]);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly formulario = this.fb.nonNullable.group({
    reference: ['', [Validators.required, Validators.maxLength(100)]],
    providerName: ['', Validators.maxLength(150)],
    periodStart: ['', Validators.required],
    periodEnd: ['', Validators.required],
  });
  constructor() {
    this.cargar();
  }
  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.http.get<{ rows: FilaCumplimiento[] }>('/api/compliance/overview').subscribe({
      next: (data) => {
        this.filas.set(data.rows);
        this.cargarPlanillas();
      },
      error: () => {
        this.error.set('No fue posible consultar la seguridad social o no tienes permiso.');
        this.cargando.set(false);
      },
    });
  }
  private cargarPlanillas(): void {
    this.http.get<Planilla[]>('/api/compliance/payrolls').subscribe({
      next: (planillas) => {
        this.planillas.set(planillas);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No fue posible consultar las planillas.');
        this.cargando.set(false);
      },
    });
  }
  alternar(id: string): void {
    this.cubiertos.update((actual) => (actual.includes(id) ? actual.filter((item) => item !== id) : [...actual, id]));
  }
  estaCubierto(id: string): boolean {
    return this.cubiertos().includes(id);
  }
  rangoInvalido(): boolean {
    const { periodStart, periodEnd } = this.formulario.getRawValue();
    return Boolean(periodStart && periodEnd && periodEnd < periodStart);
  }
  guardar(): void {
    if (this.formulario.invalid || this.rangoInvalido() || !this.cubiertos().length) return;
    this.guardando.set(true);
    this.error.set('');
    this.http
      .post('/api/compliance/payrolls', { ...this.formulario.getRawValue(), collaboratorIds: this.cubiertos() })
      .subscribe({
        next: () => {
          this.aviso.set('Planilla registrada. La cobertura quedó actualizada.');
          this.formulario.reset({ reference: '', providerName: '', periodStart: '', periodEnd: '' });
          this.cubiertos.set([]);
          this.guardando.set(false);
          this.cargar();
        },
        error: () => {
          this.error.set('No fue posible registrar la planilla. Revisa los datos e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }
  fecha(valor: string): string {
    return fechaCalendario(valor);
  }
  descargar(file: { id: string; originalName: string }): void {
    this.http.get(`/api/files/${file.id}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = file.originalName;
        enlace.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el soporte.'),
    });
  }
}
