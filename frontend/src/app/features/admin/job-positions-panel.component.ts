import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

type Cargo = {
  id: string;
  code: string;
  name: string;
  canLead: boolean;
  requiresHeightCertificate: boolean;
  active: boolean;
  activeCollaborators: number;
  withoutPin: number;
};

/**
 * Catálogo de cargos de la cuadrilla. Cambiar "Lidera la cuadrilla" o "Exige
 * certificado de alturas" afecta de inmediato quién puede ingresar y qué se le
 * exige, así que la pantalla advierte el efecto antes de guardar.
 */
@Component({
  selector: 'sg-job-positions-panel',
  imports: [ReactiveFormsModule],
  template: `
    <section class="bloque" aria-labelledby="cargos-titulo">
      <div class="titulo-seccion">
        <h2 id="cargos-titulo">Cargos de la cuadrilla</h2>
        <button class="boton secundario compacto" type="button" (click)="cargar()">Actualizar</button>
      </div>
      <p class="secundario introduccion">
        Los cargos que lideran pueden ingresar con PIN y diligenciar permisos. Los que exigen certificado de alturas
        solo integran una cuadrilla con el curso vigente.
      </p>

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      @if (aviso()) {
        <p class="mensaje ok" role="status">{{ aviso() }}</p>
      }

      @if (cargos().length) {
        <div class="tabla-scroll">
          <table class="datos">
            <thead>
              <tr>
                <th>Cargo</th>
                <th>Lidera la cuadrilla</th>
                <th>Exige alturas</th>
                <th>Colaboradores activos</th>
                <th>Estado</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (cargo of cargos(); track cargo.id) {
                <tr>
                  <td>
                    <strong>{{ cargo.name }}</strong>
                    <span class="secundario">{{ cargo.code }}</span>
                  </td>
                  <td>{{ cargo.canLead ? 'Sí' : 'No' }}</td>
                  <td>{{ cargo.requiresHeightCertificate ? 'Sí' : 'No' }}</td>
                  <td>
                    {{ cargo.activeCollaborators }}
                    @if (cargo.withoutPin) {
                      <span class="secundario">{{ cargo.withoutPin }} sin PIN: aún no pueden ingresar</span>
                    }
                  </td>
                  <td>
                    <span class="distintivo" [class]="cargo.active ? 'vigente' : 'neutro'">{{
                      cargo.active ? 'Activo' : 'Inactivo'
                    }}</span>
                  </td>
                  <td>
                    <button class="boton secundario compacto" type="button" (click)="editar(cargo)">Editar</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (!error()) {
        <p class="secundario">Consultando el catálogo…</p>
      }

      @if (edicion(); as cargo) {
        <h3>Editar {{ cargo.name }}</h3>
        <form [formGroup]="formularioEdicion" (ngSubmit)="guardarEdicion(cargo)" class="rejilla-campos dos">
          <label class="campo">
            <span>Nombre</span>
            <input formControlName="name" type="text" maxlength="80" />
          </label>
          <label class="campo">
            <span>Código</span>
            <input [value]="cargo.code" type="text" disabled />
            <span class="ayuda">El código no cambia: identifica al cargo en el sistema.</span>
          </label>
          <div class="campo ancho-total">
            <div class="casillas">
              <label class="casilla">
                <input type="checkbox" formControlName="canLead" />
                <span>Lidera la cuadrilla<span class="secundario">Ingresa con PIN y diligencia permisos.</span></span>
              </label>
              <label class="casilla">
                <input type="checkbox" formControlName="requiresHeightCertificate" />
                <span
                  >Exige certificado de alturas<span class="secundario"
                    >Sin curso vigente no integra cuadrillas.</span
                  ></span
                >
              </label>
              <label class="casilla">
                <input type="checkbox" formControlName="active" />
                <span>Activo<span class="secundario">Un cargo inactivo no se puede asignar.</span></span>
              </label>
            </div>
          </div>
          @for (advertencia of advertencias(cargo); track advertencia) {
            <p class="mensaje alerta ancho-total" role="status">{{ advertencia }}</p>
          }
          <div class="acciones ancho-total">
            <button class="boton" type="submit" [disabled]="formularioEdicion.invalid || guardando()">
              {{ guardando() ? 'Guardando…' : 'Guardar cambios' }}
            </button>
            <button class="boton secundario" type="button" (click)="edicion.set(null)">Cancelar</button>
          </div>
        </form>
      }

      <h3>Nuevo cargo</h3>
      <form [formGroup]="formularioNuevo" (ngSubmit)="crear()" class="rejilla-campos dos">
        <label class="campo">
          <span>Nombre</span>
          <input formControlName="name" type="text" maxlength="80" (input)="sugerirCodigo()" />
        </label>
        <label class="campo">
          <span>Código</span>
          <input formControlName="code" type="text" maxlength="40" />
          <span class="ayuda">Mayúsculas, números y guion bajo. Ejemplo: LINIERO.</span>
        </label>
        <div class="campo ancho-total">
          <div class="casillas">
            <label class="casilla">
              <input type="checkbox" formControlName="canLead" />
              <span>Lidera la cuadrilla<span class="secundario">Ingresa con PIN y diligencia permisos.</span></span>
            </label>
            <label class="casilla">
              <input type="checkbox" formControlName="requiresHeightCertificate" />
              <span
                >Exige certificado de alturas<span class="secundario"
                  >Sin curso vigente no integra cuadrillas.</span
                ></span
              >
            </label>
          </div>
        </div>
        <div class="acciones ancho-total">
          <button class="boton" type="submit" [disabled]="formularioNuevo.invalid || guardando()">
            {{ guardando() ? 'Creando…' : 'Crear cargo' }}
          </button>
        </div>
      </form>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobPositionsPanelComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly cargos = signal<Cargo[]>([]);
  readonly edicion = signal<Cargo | null>(null);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  private codigoEditado = false;

  readonly formularioEdicion = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    canLead: false,
    requiresHeightCertificate: false,
    active: true,
  });

  readonly formularioNuevo = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    code: ['', [Validators.required, Validators.pattern(/^[A-Z][A-Z0-9_]{1,39}$/)]],
    canLead: false,
    requiresHeightCertificate: false,
  });

  constructor() {
    this.cargar();
    this.formularioNuevo.controls.code.valueChanges.subscribe(() => (this.codigoEditado = true));
  }

  cargar(): void {
    this.error.set('');
    this.http.get<Cargo[]>('/api/job-positions').subscribe({
      next: (cargos) => this.cargos.set(cargos),
      error: () => this.error.set('No fue posible consultar el catálogo de cargos.'),
    });
  }

  editar(cargo: Cargo): void {
    this.aviso.set('');
    this.edicion.set(cargo);
    this.formularioEdicion.reset({
      name: cargo.name,
      canLead: cargo.canLead,
      requiresHeightCertificate: cargo.requiresHeightCertificate,
      active: cargo.active,
    });
  }

  /** Efectos del cambio sobre las personas que ya tienen este cargo. */
  advertencias(cargo: Cargo): string[] {
    const valores = this.formularioEdicion.getRawValue();
    const personas = cargo.activeCollaborators;
    const quienes = `${personas} ${personas === 1 ? 'colaborador' : 'colaboradores'}`;
    const lista: string[] = [];
    if (cargo.canLead && !valores.canLead && personas) {
      lista.push(`${quienes} perderán el acceso con PIN y se cerrarán sus sesiones.`);
    }
    if (!cargo.canLead && valores.canLead && personas) {
      lista.push(`${quienes} podrán ingresar solo después de que se les asigne un PIN.`);
    }
    if (!cargo.requiresHeightCertificate && valores.requiresHeightCertificate && personas) {
      lista.push(`A ${quienes} se les exigirá el certificado de alturas; sin él quedarán fuera de las cuadrillas.`);
    }
    if (cargo.active && !valores.active && personas) {
      lista.push(`Reasigna a ${quienes} antes de desactivar el cargo.`);
    }
    return lista;
  }

  guardarEdicion(cargo: Cargo): void {
    if (this.formularioEdicion.invalid || this.guardando()) return;
    const valores = this.formularioEdicion.getRawValue();
    this.guardando.set(true);
    this.error.set('');
    this.http.patch(`/api/job-positions/${cargo.id}`, { ...valores, name: valores.name.trim() }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.edicion.set(null);
        this.aviso.set('Cargo actualizado.');
        this.cargar();
      },
      error: (respuesta: HttpErrorResponse) => this.fallo(respuesta, 'No fue posible actualizar el cargo.'),
    });
  }

  /** Propone el código a partir del nombre mientras no se haya escrito a mano. */
  sugerirCodigo(): void {
    if (this.codigoEditado && this.formularioNuevo.controls.code.value) return;
    const codigo = this.formularioNuevo.controls.name.value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    this.formularioNuevo.controls.code.setValue(codigo, { emitEvent: false });
    this.codigoEditado = false;
  }

  crear(): void {
    if (this.formularioNuevo.invalid || this.guardando()) return;
    const valores = this.formularioNuevo.getRawValue();
    this.guardando.set(true);
    this.error.set('');
    this.http.post('/api/job-positions', { ...valores, name: valores.name.trim() }).subscribe({
      next: () => {
        this.guardando.set(false);
        this.formularioNuevo.reset();
        this.codigoEditado = false;
        this.aviso.set('Cargo creado.');
        this.cargar();
      },
      error: (respuesta: HttpErrorResponse) => this.fallo(respuesta, 'No fue posible crear el cargo.'),
    });
  }

  private fallo(respuesta: HttpErrorResponse, porDefecto: string): void {
    this.guardando.set(false);
    const detalle = respuesta.error?.message;
    this.error.set(typeof detalle === 'string' ? detalle : porDefecto);
  }
}
