import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { fechaHora } from '../../core/fechas';

type TipoEditable = 'text' | 'textarea' | 'yes_no' | 'select' | 'multi_select' | 'number' | 'date';
type Campo = {
  id: string;
  type: TipoEditable | 'auto';
  label: string;
  required: boolean;
  order: number;
  section?: string;
  options?: string[];
  source?: string;
  [otro: string]: unknown;
};
type Esquema = { fields: Campo[]; [otro: string]: unknown };
type Version = {
  id: string;
  versionNumber: number;
  active: boolean;
  publishedAt: string | null;
  changeReason: string;
  createdAt: string;
  submissions: number;
};
type Formato = { id: string; code: string; name: string; currentVersionId: string | null; versions: Version[] };
type Revision = { errors: string[]; warnings: string[] };

const TIPOS: { valor: TipoEditable; nombre: string }[] = [
  { valor: 'yes_no', nombre: 'Sí / No' },
  { valor: 'select', nombre: 'Una opción de una lista' },
  { valor: 'multi_select', nombre: 'Varias opciones de una lista' },
  { valor: 'text', nombre: 'Texto corto' },
  { valor: 'textarea', nombre: 'Texto largo' },
  { valor: 'number', nombre: 'Número' },
  { valor: 'date', nombre: 'Fecha' },
];

/** Identificador estable a partir de la etiqueta: minúsculas, sin tildes, con guion bajo. */
function identificador(texto: string): string {
  const base = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return /^[a-z]/.test(base) ? base : `campo_${base}`;
}

/**
 * Editor de versiones del formato. Trabaja sobre una copia local del esquema:
 * nada se guarda hasta "Guardar borrador", y nada cambia para los
 * colaboradores hasta publicar. Antes de guardar, el servidor revisa que el
 * PDF oficial siga completo con el esquema nuevo.
 */
@Component({
  selector: 'sg-form-editor',
  imports: [FormsModule],
  template: `
    @if (formato(); as forma) {
      <section class="bloque" aria-labelledby="versiones-titulo">
        <div class="titulo-seccion">
          <h2 id="versiones-titulo">{{ forma.name }} · {{ forma.code }}</h2>
          <button class="boton secundario compacto" type="button" (click)="cargar()">Actualizar</button>
        </div>
        <p class="secundario introduccion">
          Cada permiso conserva la versión con la que se diligenció. Publicar una versión solo afecta a los permisos
          nuevos.
        </p>
        <div class="tabla-scroll">
          <table class="datos">
            <thead>
              <tr>
                <th>Versión</th>
                <th>Estado</th>
                <th>Motivo del cambio</th>
                <th>Permisos</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (version of forma.versions; track version.id) {
                <tr>
                  <td>
                    <strong>v{{ version.versionNumber }}</strong>
                    <span class="secundario">{{ fecha(version.createdAt) }}</span>
                  </td>
                  <td>
                    <span class="distintivo" [class]="claseVersion(version)">{{ estadoVersion(version) }}</span>
                  </td>
                  <td>{{ version.changeReason }}</td>
                  <td>{{ version.submissions }}</td>
                  <td>
                    <div class="acciones">
                      <button class="boton secundario compacto" type="button" (click)="editarDesde(forma, version)">
                        Editar a partir de esta
                      </button>
                      @if (!version.active) {
                        <button
                          class="boton compacto"
                          type="button"
                          [disabled]="ocupado()"
                          (click)="publicar(forma, version)"
                        >
                          Publicar
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (campos().length) {
        <section class="bloque" aria-labelledby="editor-titulo">
          <div class="titulo-seccion">
            <h2 id="editor-titulo">Editando a partir de v{{ base()?.versionNumber }}</h2>
            <button class="boton secundario compacto" type="button" (click)="descartar()">Descartar cambios</button>
          </div>
          <p class="secundario introduccion">
            Los campos automáticos los completa el sistema y no se editan. Si un campo o una opción se imprime en el PDF
            oficial, la revisión impedirá retirarlo.
          </p>

          @for (seccion of secciones(); track seccion) {
            <h3>{{ seccion }}</h3>
            <ol class="editor-campos">
              @for (campo of camposDe(seccion); track campo.id; let primero = $first; let ultimo = $last) {
                <li class="editor-campo" [class.automatico]="campo.type === 'auto'">
                  <div class="editor-fila">
                    <div>
                      <strong>{{ campo.label }}</strong>
                      <span class="secundario"
                        >{{ nombreTipo(campo) }} · {{ campo.required ? 'Obligatorio' : 'Opcional' }} ·
                        {{ campo.id }}</span
                      >
                    </div>
                    <div class="acciones">
                      <button
                        class="boton secundario compacto"
                        type="button"
                        [disabled]="primero"
                        (click)="mover(campo, -1)"
                        [attr.aria-label]="'Subir ' + campo.label"
                      >
                        ↑
                      </button>
                      <button
                        class="boton secundario compacto"
                        type="button"
                        [disabled]="ultimo"
                        (click)="mover(campo, 1)"
                        [attr.aria-label]="'Bajar ' + campo.label"
                      >
                        ↓
                      </button>
                      @if (campo.type !== 'auto') {
                        <button class="boton secundario compacto" type="button" (click)="alternarEdicion(campo.id)">
                          {{ editando() === campo.id ? 'Cerrar' : 'Editar' }}
                        </button>
                        <button class="boton secundario compacto" type="button" (click)="retirar(campo)">
                          Retirar
                        </button>
                      }
                    </div>
                  </div>

                  @if (editando() === campo.id) {
                    <div class="rejilla-campos dos editor-detalle">
                      <label class="campo ancho-total">
                        <span>Pregunta o etiqueta</span>
                        <input
                          type="text"
                          maxlength="500"
                          [ngModel]="campo.label"
                          (ngModelChange)="actualizar(campo, { label: $event })"
                        />
                      </label>
                      <label class="casilla">
                        <input
                          type="checkbox"
                          [ngModel]="campo.required"
                          (ngModelChange)="actualizar(campo, { required: $event })"
                        />
                        <span>Obligatorio</span>
                      </label>
                      @if (campo.type === 'select' || campo.type === 'multi_select') {
                        <label class="campo ancho-total">
                          <span>Opciones, una por línea</span>
                          <!-- Se aplica al salir del campo: hacerlo en cada tecla borraría la línea nueva. -->
                          <textarea
                            rows="5"
                            [value]="(campo.options ?? []).join('\\n')"
                            (change)="actualizarOpciones(campo, $any($event.target).value)"
                          ></textarea>
                          <span class="ayuda">Renombrar una opción equivale a retirarla y agregar otra.</span>
                        </label>
                      }
                    </div>
                  }
                </li>
              }
            </ol>
          }

          <h3>Agregar un campo</h3>
          <div class="rejilla-campos dos">
            <label class="campo ancho-total">
              <span>Pregunta o etiqueta</span>
              <input type="text" maxlength="500" [(ngModel)]="nuevoLabel" (ngModelChange)="sugerirId()" />
            </label>
            <label class="campo">
              <span>Tipo de respuesta</span>
              <select [(ngModel)]="nuevoTipo">
                @for (tipo of tipos; track tipo.valor) {
                  <option [value]="tipo.valor">{{ tipo.nombre }}</option>
                }
              </select>
            </label>
            <label class="campo">
              <span>Sección</span>
              <select [(ngModel)]="nuevaSeccion">
                @for (seccion of secciones(); track seccion) {
                  <option [value]="seccion">{{ seccion }}</option>
                }
              </select>
            </label>
            <label class="campo">
              <span>Identificador</span>
              <input type="text" maxlength="80" [(ngModel)]="nuevoId" (ngModelChange)="idEditado = true" />
              <span class="ayuda">No cambia después de publicar. Minúsculas, números y guion bajo.</span>
            </label>
            <label class="casilla">
              <input type="checkbox" [(ngModel)]="nuevoObligatorio" />
              <span>Obligatorio</span>
            </label>
            @if (nuevoTipo === 'select' || nuevoTipo === 'multi_select') {
              <label class="campo ancho-total">
                <span>Opciones, una por línea</span>
                <textarea rows="4" [(ngModel)]="nuevasOpciones"></textarea>
              </label>
            }
            <div class="acciones ancho-total">
              <button class="boton secundario" type="button" (click)="agregar()">Agregar campo</button>
            </div>
          </div>

          @if (revision(); as resultado) {
            @for (error of resultado.errors; track error) {
              <p class="mensaje error" role="alert">{{ error }}</p>
            }
            @for (advertencia of resultado.warnings; track advertencia) {
              <p class="mensaje alerta" role="status">{{ advertencia }}</p>
            }
            @if (!resultado.errors.length && !resultado.warnings.length) {
              <p class="mensaje ok" role="status">Sin observaciones: el PDF oficial sigue completo.</p>
            }
          }

          <h3>Guardar</h3>
          <div class="rejilla-campos dos">
            <label class="campo ancho-total">
              <span>Motivo del cambio</span>
              <input
                type="text"
                maxlength="500"
                [(ngModel)]="motivo"
                placeholder="Queda en el historial y la auditoría"
              />
            </label>
            <div class="acciones ancho-total">
              <button class="boton secundario" type="button" [disabled]="ocupado()" (click)="revisar()">
                Revisar cambios
              </button>
              <button
                class="boton"
                type="button"
                [disabled]="ocupado() || motivo.trim().length < 3"
                (click)="guardarBorrador()"
              >
                {{ ocupado() ? 'Guardando…' : 'Guardar borrador' }}
              </button>
            </div>
          </div>
        </section>
      }

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      @if (aviso()) {
        <p class="mensaje ok" role="status">{{ aviso() }}</p>
      }
    } @else if (error()) {
      <p class="mensaje error" role="alert">{{ error() }}</p>
    } @else {
      <p class="secundario">Cargando formatos…</p>
    }
  `,
  styles: [
    `
      .editor-campos {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 8px;
      }
      .editor-campo {
        border: 1px solid var(--borde);
        border-radius: 12px;
        padding: 12px 14px;
        background: var(--superficie);
      }
      .editor-campo.automatico {
        background: var(--fondo);
      }
      .editor-fila {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
      }
      .editor-fila .secundario {
        display: block;
        font-size: 0.8125rem;
      }
      .editor-detalle {
        margin-top: 12px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormEditorComponent {
  private readonly http = inject(HttpClient);

  readonly tipos = TIPOS;
  readonly formato = signal<Formato | null>(null);
  readonly base = signal<Version | null>(null);
  readonly campos = signal<Campo[]>([]);
  private esquemaBase: Esquema | null = null;
  readonly editando = signal<string | null>(null);
  readonly revision = signal<Revision | null>(null);
  readonly ocupado = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');

  motivo = '';
  nuevoLabel = '';
  nuevoId = '';
  nuevoTipo: TipoEditable = 'yes_no';
  nuevaSeccion = '';
  nuevoObligatorio = true;
  nuevasOpciones = '';
  idEditado = false;

  readonly secciones = computed(() => [...new Set(this.campos().map((campo) => campo.section ?? ''))]);

  constructor() {
    this.cargar();
  }

  cargar(): void {
    this.error.set('');
    this.http.get<Formato[]>('/api/forms').subscribe({
      next: (formatos) =>
        this.formato.set(formatos.find((forma) => forma.code === 'HSE-FO-016') ?? formatos[0] ?? null),
      error: () => this.error.set('No fue posible consultar los formatos.'),
    });
  }

  editarDesde(forma: Formato, version: Version): void {
    this.aviso.set('');
    this.error.set('');
    this.http.get<{ schemaJson: Esquema }>(`/api/forms/${forma.id}/versions/${version.id}`).subscribe({
      next: ({ schemaJson }) => {
        this.esquemaBase = schemaJson;
        this.base.set(version);
        this.campos.set(this.conSeccionExplicita(schemaJson.fields));
        this.nuevaSeccion = this.secciones()[0] ?? '';
        this.revision.set(null);
        this.editando.set(null);
      },
      error: () => this.error.set('No fue posible abrir esa versión.'),
    });
  }

  descartar(): void {
    this.campos.set([]);
    this.base.set(null);
    this.revision.set(null);
    this.motivo = '';
  }

  camposDe(seccion: string): Campo[] {
    return this.campos().filter((campo) => (campo.section ?? '') === seccion);
  }

  /** Sube o baja un campo dentro de su sección. */
  mover(campo: Campo, direccion: -1 | 1): void {
    const hermanos = this.camposDe(campo.section ?? '');
    const vecino = hermanos[hermanos.indexOf(campo) + direccion];
    if (!vecino) return;
    this.campos.update((lista) => {
      const copia = [...lista];
      const a = copia.indexOf(campo);
      const b = copia.indexOf(vecino);
      [copia[a], copia[b]] = [copia[b], copia[a]];
      return copia;
    });
    this.revision.set(null);
  }

  alternarEdicion(id: string): void {
    this.editando.set(this.editando() === id ? null : id);
  }

  actualizar(campo: Campo, cambios: Partial<Campo>): void {
    this.campos.update((lista) => lista.map((otro) => (otro.id === campo.id ? { ...otro, ...cambios } : otro)));
    this.revision.set(null);
  }

  actualizarOpciones(campo: Campo, texto: string): void {
    this.actualizar(campo, {
      options: texto
        .split('\n')
        .map((opcion) => opcion.trim())
        .filter(Boolean),
    });
  }

  retirar(campo: Campo): void {
    if (!confirm(`¿Retirar "${campo.label}" de esta versión? Los permisos anteriores conservan su respuesta.`)) return;
    this.campos.update((lista) => lista.filter((otro) => otro.id !== campo.id));
    this.revision.set(null);
  }

  sugerirId(): void {
    if (!this.idEditado || !this.nuevoId) this.nuevoId = identificador(this.nuevoLabel);
  }

  agregar(): void {
    this.error.set('');
    const label = this.nuevoLabel.trim();
    const id = this.nuevoId.trim();
    if (!label) return this.error.set('Escribe la pregunta del campo nuevo.');
    if (!/^[a-z][a-z0-9_]{1,80}$/.test(id)) return this.error.set('El identificador no es válido.');
    if (this.campos().some((campo) => campo.id === id))
      return this.error.set('Ya existe un campo con ese identificador.');
    const conOpciones = this.nuevoTipo === 'select' || this.nuevoTipo === 'multi_select';
    const options = this.nuevasOpciones
      .split('\n')
      .map((opcion) => opcion.trim())
      .filter(Boolean);
    if (conOpciones && !options.length) return this.error.set('Agrega al menos una opción.');

    const nuevo: Campo = {
      id,
      type: this.nuevoTipo,
      label,
      required: this.nuevoObligatorio,
      order: 0,
      section: this.nuevaSeccion,
      ...(conOpciones ? { options } : {}),
    };
    // Queda al final de su sección.
    this.campos.update((lista) => {
      const ultimo = lista.map((campo) => campo.section).lastIndexOf(this.nuevaSeccion);
      const copia = [...lista];
      copia.splice(ultimo + 1, 0, nuevo);
      return copia;
    });
    this.nuevoLabel = '';
    this.nuevoId = '';
    this.nuevasOpciones = '';
    this.idEditado = false;
    this.revision.set(null);
  }

  revisar(): void {
    const forma = this.formato();
    if (!forma || this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    this.http.post<Revision>(`/api/forms/${forma.id}/versions/check`, { schemaJson: this.esquema() }).subscribe({
      next: (revision) => {
        this.revision.set(revision);
        this.ocupado.set(false);
      },
      error: (respuesta: HttpErrorResponse) => this.fallo(respuesta, 'No fue posible revisar el formato.'),
    });
  }

  guardarBorrador(): void {
    const forma = this.formato();
    if (!forma || this.ocupado()) return;
    this.ocupado.set(true);
    this.error.set('');
    this.http
      .post<{ versionNumber: number; warnings: string[] }>(`/api/forms/${forma.id}/versions`, {
        schemaJson: this.esquema(),
        changeReason: this.motivo.trim(),
      })
      .subscribe({
        next: (version) => {
          this.ocupado.set(false);
          this.revision.set({ errors: [], warnings: version.warnings });
          this.aviso.set(
            `Borrador v${version.versionNumber} guardado. Publícalo desde el historial cuando esté listo.`,
          );
          this.campos.set([]);
          this.base.set(null);
          this.motivo = '';
          this.cargar();
        },
        error: (respuesta: HttpErrorResponse) => this.fallo(respuesta, 'No fue posible guardar el borrador.'),
      });
  }

  publicar(forma: Formato, version: Version): void {
    if (this.ocupado()) return;
    const mensaje = `¿Publicar la v${version.versionNumber}? Los permisos nuevos usarán esta versión desde ahora.`;
    if (!confirm(mensaje)) return;
    this.ocupado.set(true);
    this.error.set('');
    this.http.post(`/api/forms/${forma.id}/versions/${version.id}/publish`, {}).subscribe({
      next: () => {
        this.ocupado.set(false);
        this.aviso.set(`La v${version.versionNumber} quedó publicada.`);
        this.cargar();
      },
      error: (respuesta: HttpErrorResponse) => this.fallo(respuesta, 'No fue posible publicar la versión.'),
    });
  }

  nombreTipo(campo: Campo): string {
    if (campo.type === 'auto') return 'Automático';
    return TIPOS.find((tipo) => tipo.valor === campo.type)?.nombre ?? campo.type;
  }

  estadoVersion(version: Version): string {
    if (version.active) return 'Publicada';
    return version.publishedAt ? 'Publicada antes' : 'Borrador';
  }

  claseVersion(version: Version): string {
    if (version.active) return 'vigente';
    return version.publishedAt ? 'neutro' : 'por-vencer';
  }

  fecha(valor: string): string {
    return fechaHora(valor);
  }

  /** El esquema a enviar: el orden visible se vuelve el orden del formulario. */
  private esquema(): Esquema {
    return {
      ...(this.esquemaBase ?? {}),
      fields: this.campos().map((campo, indice) => ({ ...campo, order: indice + 1 })),
    };
  }

  /**
   * En el esquema solo el primer campo de cada sección la declara; el resto la
   * hereda. Se hace explícita para poder reordenar sin que un campo cambie de
   * sección por accidente.
   */
  private conSeccionExplicita(fields: Campo[]): Campo[] {
    let actual = 'Datos del permiso';
    return [...fields]
      .sort((a, b) => a.order - b.order)
      .map((campo) => {
        if (campo.section) actual = campo.section;
        return { ...campo, section: actual };
      });
  }

  private fallo(respuesta: HttpErrorResponse, porDefecto: string): void {
    this.ocupado.set(false);
    const detalle = respuesta.error?.message;
    if (Array.isArray(detalle)) {
      this.revision.set({ errors: detalle.map(String), warnings: respuesta.error?.warnings ?? [] });
      this.error.set('Corrige lo señalado antes de guardar.');
    } else {
      this.error.set(typeof detalle === 'string' ? detalle : porDefecto);
    }
  }
}
