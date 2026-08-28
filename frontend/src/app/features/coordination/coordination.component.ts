import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthSessionService } from '../../core/auth-session.service';
import { fechaCalendario, fechaHora } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';

type Dashboard = { pending: number; approved: number; rejected: number; blockedByArl: number };

type Submission = {
  id: string;
  submittedAt: string;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  form: { code: string; name: string; version: number };
};

type Campo = { id: string; label: string; order: number; section?: string };

type Detail = {
  id: string;
  submittedAt: string | null;
  safetyTalkConfirmedAt: string | null;
  answersJson: Record<string, unknown>;
  arlSnapshotJson: { providerName?: string; startDate?: string; endDate?: string; status?: string };
  collaborator: { firstName: string; lastName: string; documentNumber: string; jobTitle?: string; team?: string };
  formVersion: { versionNumber: number; schemaJson: { fields: Campo[] }; form: { code: string; name: string } };
  signature: { sha256: string; file: { id: string } } | null;
};

type Colaborador = {
  id: string;
  documentType: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  team: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
};

type FilaArl = {
  collaborator: { id: string; documentNumber: string };
  affiliation: { providerName: string; endDate: string } | null;
  arlStatus: 'VIGENTE' | 'PROXIMA_A_VENCER' | 'VENCIDA';
};

type Respuesta = { etiqueta: string; valor: string; alerta: boolean };
type Grupo = { seccion: string; respuestas: Respuesta[] };

/**
 * Puesto de trabajo de la coordinadora. La especificación le asigna dos
 * responsabilidades: autorizar el inicio de labores y crear los perfiles de
 * los colaboradores. Ambas viven aquí, separadas en pestañas.
 */
@Component({
  imports: [ReactiveFormsModule, LogoutButtonComponent],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <span class="sigla" aria-hidden="true">SST</span>
          <span class="nombre">
            Coordinación
            <span class="lema">Autorización de inicio de labores</span>
          </span>
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

      <section class="area-masthead" aria-labelledby="coordinacion-titulo">
        <div class="area-masthead-texto">
          <h1 id="coordinacion-titulo">Coordinación</h1>
          <p>Revisa permisos de trabajo y gestiona los perfiles de colaboradores.</p>
        </div>
      <div class="pestanas area-tabs" role="tablist" aria-label="Secciones de Coordinación">
        <button
          role="tab"
          [attr.aria-selected]="pestana() === 'bandeja'"
          (click)="pestana.set('bandeja')"
          type="button"
        >
          Bandeja de revisión
          @if (pending().length) {
            <span class="globo">{{ pending().length }}</span>
          }
        </button>
      </div>
      </section>

      <!-- ══════════════ BANDEJA ══════════════ -->
      @if (pestana() === 'bandeja') {
        @if (dashboard(); as m) {
          <section class="indicadores">
            <div class="indicador">
              <span class="cifra">{{ m.pending }}</span>
              <span class="rotulo">Esperando revisión</span>
            </div>
            <div class="indicador">
              <span class="cifra">{{ m.approved }}</span>
              <span class="rotulo">Autorizados</span>
            </div>
            <div class="indicador">
              <span class="cifra">{{ m.rejected }}</span>
              <span class="rotulo">Rechazados</span>
            </div>
            <div class="indicador" [class.atencion]="m.blockedByArl > 0">
              <span class="cifra">{{ m.blockedByArl }}</span>
              <span class="rotulo">Bloqueados por ARL</span>
            </div>
          </section>
        }

        @if (detail(); as item) {
          <!-- ── Panel de revisión ── -->
          <section class="bloque revision">
            <div class="titulo-seccion">
              <h2>{{ item.collaborator.firstName }} {{ item.collaborator.lastName }}</h2>
              <button class="boton secundario compacto" type="button" (click)="cerrarRevision()">
                Volver a la bandeja
              </button>
            </div>

            <dl class="ficha">
              <div>
                <dt>Documento</dt>
                <dd>{{ item.collaborator.documentNumber }}</dd>
              </div>
              <div>
                <dt>Cargo</dt>
                <dd>{{ item.collaborator.jobTitle || '—' }}</dd>
              </div>
              <div>
                <dt>Formulario</dt>
                <dd>{{ item.formVersion.form.code }} · versión {{ item.formVersion.versionNumber }}</dd>
              </div>
              <div>
                <dt>Enviado</dt>
                <dd>{{ fecha(item.submittedAt) }}</dd>
              </div>
              <div>
                <dt>Charla de seguridad</dt>
                <dd>Confirmada · {{ fecha(item.safetyTalkConfirmedAt) }}</dd>
              </div>
              <div>
                <dt>ARL al momento del envío</dt>
                <dd>
                  {{ item.arlSnapshotJson.providerName || 'Sin afiliación' }}
                  <span class="distintivo" [class]="claseArl(item.arlSnapshotJson.status)">{{
                    textoArl(item.arlSnapshotJson.status)
                  }}</span>
                  @if (item.arlSnapshotJson.endDate) {
                    <span class="secundario">Vence {{ soloFecha(item.arlSnapshotJson.endDate) }}</span>
                  }
                </dd>
              </div>
            </dl>

            @if (incumplimientos().length) {
              <p class="mensaje alerta" role="status">
                <strong>{{ incumplimientos().length }}</strong>
                {{ incumplimientos().length === 1 ? 'respuesta marcada en NO' : 'respuestas marcadas en NO' }}
                dentro de la lista de verificación. Revísalas antes de autorizar.
              </p>
            }

            @for (grupo of grupos(); track grupo.seccion) {
              <h3>{{ grupo.seccion }}</h3>
              <div class="tabla-scroll">
                <table class="datos">
                  <tbody>
                    @for (r of grupo.respuestas; track r.etiqueta) {
                      <tr [class.fila-alerta]="r.alerta">
                        <th scope="row" class="campo-nombre">{{ r.etiqueta }}</th>
                        <td>
                          @if (r.alerta) {
                            <span class="distintivo vencida">{{ r.valor }}</span>
                          } @else {
                            {{ r.valor }}
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }

            <h3>Firma manuscrita</h3>
            @if (firmaUrl(); as url) {
              <img class="firma" [src]="url" alt="Firma manuscrita del colaborador" />
            } @else {
              <p class="secundario">Cargando firma…</p>
            }
            <p class="huella">SHA-256 · {{ item.signature?.sha256 || 'No disponible' }}</p>

            <h3>Decisión</h3>
            <div class="rejilla-campos">
              <label class="campo">
                <span>Observación o motivo</span>
                <textarea
                  rows="3"
                  [value]="motivo()"
                  (input)="motivo.set($any($event.target).value)"
                  placeholder="Obligatorio si vas a rechazar. Queda registrado en la auditoría."
                ></textarea>
              </label>
              <div class="acciones">
                <button class="boton" type="button" [disabled]="decidiendo()" (click)="decidir(item.id, 'APPROVED')">
                  Autorizar inicio de labores
                </button>
                <button
                  class="boton peligro"
                  type="button"
                  [disabled]="decidiendo() || !motivo().trim()"
                  (click)="decidir(item.id, 'REJECTED')"
                >
                  Rechazar
                </button>
              </div>
              @if (!motivo().trim()) {
                <p class="secundario">Para rechazar debes escribir el motivo.</p>
              }
            </div>
          </section>
        } @else {
          <!-- ── Lista de pendientes ── -->
          <div class="titulo-seccion">
            <h2>
              Envíos pendientes <span class="conteo">({{ pending().length }})</span>
            </h2>
            <div class="acciones">
              @if (ultimoPdf()) {
                <button class="boton secundario compacto" type="button" (click)="descargar(ultimoPdf()!)">
                  Descargar último PDF
                </button>
              }
              <button class="boton secundario compacto" type="button" (click)="cargar()">Actualizar</button>
            </div>
          </div>

          @if (pending().length) {
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Formulario</th>
                    <th>Enviado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of pending(); track item.id) {
                    <tr>
                      <td>
                        <strong>{{ item.collaborator.firstName }} {{ item.collaborator.lastName }}</strong>
                        <span class="secundario">{{ item.collaborator.documentNumber }}</span>
                      </td>
                      <td>
                        {{ item.form.code }}
                        <span class="secundario">versión {{ item.form.version }}</span>
                      </td>
                      <td>{{ fecha(item.submittedAt) }}</td>
                      <td>
                        <button class="boton compacto" type="button" (click)="abrir(item.id)">Revisar</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="vacio">
              <strong>No hay envíos esperando revisión</strong>
              Cuando un colaborador firme y envíe su permiso, aparecerá aquí.
            </p>
          }
        }
      }

      <!-- ══════════════ COLABORADORES ══════════════ -->
      @if (pestana() === 'colaboradores') {
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>Registrar colaborador</h2>
          </div>
          <p class="secundario introduccion">
            El colaborador ingresará con su número de documento y el PIN que definas aquí. Queda registrado quién creó
            el perfil y cuándo.
          </p>

          <form [formGroup]="formulario" (ngSubmit)="crear()" class="rejilla-campos dos">
            <label class="campo">
              <span>Tipo de documento</span>
              <select formControlName="documentType">
                <option value="CC">Cédula de ciudadanía</option>
                <option value="CE">Cédula de extranjería</option>
                <option value="PA">Pasaporte</option>
                <option value="PEP">Permiso especial de permanencia</option>
              </select>
            </label>

            <label class="campo">
              <span>Número de documento</span>
              <input formControlName="documentNumber" inputmode="numeric" autocomplete="off" />
            </label>

            <label class="campo">
              <span>Nombres</span>
              <input formControlName="firstName" autocomplete="off" />
            </label>

            <label class="campo">
              <span>Apellidos</span>
              <input formControlName="lastName" autocomplete="off" />
            </label>

            <label class="campo">
              <span>Cargo</span>
              <input formControlName="jobTitle" autocomplete="off" placeholder="Opcional" />
            </label>

            <label class="campo">
              <span>Cuadrilla o equipo</span>
              <input formControlName="team" autocomplete="off" placeholder="Opcional" />
            </label>

            <label class="campo">
              <span>Correo</span>
              <input formControlName="email" type="email" autocomplete="off" placeholder="Opcional" />
            </label>

            <label class="campo">
              <span>Teléfono</span>
              <input formControlName="phone" inputmode="tel" autocomplete="off" placeholder="Opcional" />
            </label>

            <label class="campo ancho-total">
              <span>PIN de acceso</span>
              <input class="numerico" formControlName="pin" inputmode="numeric" autocomplete="off" />
              <span class="ayuda">Entre 4 y 12 caracteres. Entrégaselo al colaborador en persona.</span>
            </label>

            <div class="acciones ancho-total">
              <button class="boton" [disabled]="formulario.invalid || guardando()">
                {{ guardando() ? 'Registrando…' : 'Registrar colaborador' }}
              </button>
              <button class="boton secundario" type="button" (click)="formulario.reset(valoresIniciales)">
                Limpiar
              </button>
            </div>
          </form>
        </section>

        <section class="bloque">
          <div class="titulo-seccion">
            <h2>
              Colaboradores registrados <span class="conteo">({{ colaboradores().length }})</span>
            </h2>
            <button class="boton secundario compacto" type="button" (click)="cargarColaboradores()">Actualizar</button>
          </div>

          @if (colaboradores().length) {
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Cargo y equipo</th>
                    <th>ARL</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (c of colaboradores(); track c.id) {
                    <tr>
                      <td>
                        <strong>{{ c.firstName }} {{ c.lastName }}</strong>
                        <span class="secundario">{{ c.documentType }} {{ c.documentNumber }}</span>
                      </td>
                      <td>
                        {{ c.jobTitle || '—' }}
                        @if (c.team) {
                          <span class="secundario">{{ c.team }}</span>
                        }
                      </td>
                      <td>
                        <span class="distintivo" [class]="claseArl(arlDe(c.id))">{{ textoArl(arlDe(c.id)) }}</span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="c.status === 'ACTIVE' ? 'vigente' : 'neutro'">
                          {{ c.status === 'ACTIVE' ? 'Activo' : 'Inactivo' }}
                        </span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="vacio">
              <strong>Todavía no hay colaboradores</strong>
              Registra el primero con el formulario de arriba.
            </p>
          }
        </section>
      }
    </main>
  `,
  styles: [
    `
      .ficha {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px 24px;
        margin: 0 0 26px;
        padding-bottom: 22px;
        border-bottom: 1px solid var(--borde);
      }
      .ficha dt {
        color: var(--tinta-suave);
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .ficha dd {
        margin: 3px 0 0;
        font-size: 1.0625rem;
      }
      .ficha .distintivo {
        margin-left: 6px;
        font-size: 0.75rem;
      }

      h3 {
        margin: 26px 0 12px;
        font-size: 1.0625rem;
      }
      .fila-alerta {
        background: var(--error-fondo);
      }
      .fila-alerta .campo-nombre {
        color: var(--error);
      }
      .campo-nombre {
        width: 42%;
        color: var(--tinta-media);
        font-weight: 600;
      }
      .firma {
        display: block;
        max-width: 320px;
        width: 100%;
        border: 1px solid var(--borde-fuerte);
        border-radius: var(--radio);
        background: #fff;
      }
      .huella {
        margin: 8px 0 0;
        color: var(--tinta-suave);
        font-size: 0.8125rem;
        word-break: break-all;
      }
      .secundario {
        display: block;
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }
      .introduccion {
        margin: -6px 0 20px;
      }
      textarea {
        resize: vertical;
        min-height: 84px;
      }
      .area-masthead {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin: 0 0 28px;
        padding: 20px 24px 14px;
        border-radius: 16px;
        background: #efeee8;
      }
      .area-masthead h1 { margin: 0 0 4px; font-size: clamp(1.45rem, 2.6vw, 2rem); letter-spacing: -0.03em; }
      .area-masthead p { margin: 0; color: var(--tinta-media); font-size: .875rem; }
      .area-tabs { margin: 0; border: 0; gap: 6px; }
      .area-tabs button { border: 0; border-radius: 999px; padding: 9px 14px; }
      .area-tabs button[aria-selected='true'] { background: #98cbbb; color: #123f38; }
      @media (max-width: 640px) {
        .area-masthead { align-items: start; flex-direction: column; padding: 18px 16px 12px; }
        .area-tabs { overflow-x: auto; max-width: 100%; }
        .area-tabs button { white-space: nowrap; }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoordinationComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);

  readonly pestana = signal<'bandeja' | 'colaboradores'>('bandeja');
  readonly dashboard = signal<Dashboard | null>(null);
  readonly pending = signal<Submission[]>([]);
  readonly detail = signal<Detail | null>(null);
  readonly firmaUrl = signal<string | null>(null);
  readonly motivo = signal('');
  readonly decidiendo = signal(false);
  readonly ultimoPdf = signal<string | null>(null);
  readonly colaboradores = signal<Colaborador[]>([]);
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');

  /** Estado de ARL por colaborador, para mostrarlo junto a cada perfil. */
  private readonly arlPorColaborador = signal<Record<string, FilaArl['arlStatus']>>({});

  readonly valoresIniciales = {
    documentType: 'CC',
    documentNumber: '',
    firstName: '',
    lastName: '',
    jobTitle: '',
    team: '',
    email: '',
    phone: '',
    pin: '',
  };

  readonly formulario = this.fb.nonNullable.group({
    documentType: ['CC', Validators.required],
    documentNumber: ['', [Validators.required, Validators.pattern(/^[0-9A-Za-z-]{5,30}$/)]],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    jobTitle: ['', Validators.maxLength(150)],
    team: ['', Validators.maxLength(100)],
    email: ['', Validators.email],
    phone: ['', Validators.maxLength(30)],
    pin: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(12)]],
  });

  /**
   * Traduce las respuestas crudas a las etiquetas del formulario publicado y
   * las agrupa por sección. Un "NO" dentro de la lista de verificación es
   * justo lo que debe saltar a la vista antes de autorizar un trabajo en
   * altura, así que se marca como alerta.
   */
  readonly grupos = computed<Grupo[]>(() => {
    const item = this.detail();
    if (!item) return [];
    const campos = (item.formVersion.schemaJson?.fields ?? []).slice().sort((a, b) => a.order - b.order);
    const grupos: Grupo[] = [];
    let seccion = 'Datos del permiso';

    for (const campo of campos) {
      // La sección se declara una vez y rige hasta que aparece la siguiente.
      if (campo.section) seccion = campo.section;
      const valor = item.answersJson[campo.id];
      if (valor === undefined) continue;
      this.agregar(grupos, seccion, {
        etiqueta: campo.label ?? campo.id,
        valor: this.formatearValor(valor),
        alerta: valor === 'NO',
      });
    }

    // Una respuesta cuyo campo ya no existe en el esquema sigue siendo evidencia.
    const conocidos = new Set(campos.map((campo) => campo.id));
    for (const [id, valor] of Object.entries(item.answersJson)) {
      if (conocidos.has(id)) continue;
      this.agregar(grupos, 'Otras respuestas registradas', {
        etiqueta: id,
        valor: this.formatearValor(valor),
        alerta: valor === 'NO',
      });
    }
    return grupos;
  });

  readonly incumplimientos = computed<Respuesta[]>(() =>
    this.grupos().flatMap((grupo) => grupo.respuestas.filter((respuesta) => respuesta.alerta)),
  );

  private agregar(grupos: Grupo[], seccion: string, respuesta: Respuesta): void {
    const grupo = grupos.find((candidato) => candidato.seccion === seccion);
    if (grupo) grupo.respuestas.push(respuesta);
    else grupos.push({ seccion, respuestas: [respuesta] });
  }

  constructor() {
    this.cargar();
  }

  // ── Bandeja ──────────────────────────────────────────────
  cargar(): void {
    this.error.set('');
    this.http.get<Dashboard>('/api/coordination/dashboard').subscribe({
      next: (dashboard) => this.dashboard.set(dashboard),
      error: () => this.error.set('No tienes permiso para consultar coordinación.'),
    });
    this.http.get<Submission[]>('/api/coordination/submissions/pending').subscribe({
      next: (pending) => this.pending.set(pending),
      error: () => undefined,
    });
  }

  abrir(id: string): void {
    this.motivo.set('');
    this.firmaUrl.set(null);
    this.http.get<Detail>(`/api/coordination/submissions/${id}`).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        if (detail.signature) this.cargarFirma(detail.signature.file.id);
      },
      error: () => this.error.set('No fue posible abrir el envío.'),
    });
  }

  cerrarRevision(): void {
    this.liberarFirma();
    this.detail.set(null);
    this.motivo.set('');
  }

  decidir(id: string, decision: 'APPROVED' | 'REJECTED'): void {
    const texto = this.motivo().trim();
    if (decision === 'REJECTED' && !texto) return;
    this.decidiendo.set(true);
    this.error.set('');
    this.http
      .post<{ pdfFileId: string }>(
        `/api/coordination/submissions/${id}/decision`,
        decision === 'REJECTED' ? { decision, reason: texto } : { decision, observation: texto || undefined },
      )
      .subscribe({
        next: (result) => {
          this.ultimoPdf.set(result.pdfFileId);
          this.aviso.set(
            decision === 'APPROVED'
              ? 'Autorizado. El colaborador ya puede iniciar labores y el PDF quedó generado.'
              : 'Envío rechazado. El colaborador verá el motivo registrado.',
          );
          this.decidiendo.set(false);
          this.cerrarRevision();
          this.cargar();
        },
        error: () => {
          this.error.set('No fue posible registrar la decisión.');
          this.decidiendo.set(false);
        },
      });
  }

  descargar(id: string): void {
    this.http.get(`/api/files/${id}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'permiso-sg-sst.pdf';
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el PDF.'),
    });
  }

  // ── Colaboradores ────────────────────────────────────────
  verColaboradores(): void {
    this.pestana.set('colaboradores');
    if (!this.colaboradores().length) this.cargarColaboradores();
  }

  cargarColaboradores(): void {
    this.http.get<Colaborador[]>('/api/collaborators').subscribe({
      next: (lista) => this.colaboradores.set(lista),
      error: () => this.error.set('No fue posible cargar los colaboradores.'),
    });
    this.http.get<FilaArl[]>('/api/arl').subscribe({
      next: (filas) =>
        this.arlPorColaborador.set(
          Object.fromEntries(filas.map((fila) => [fila.collaborator.id, fila.arlStatus])) as Record<
            string,
            FilaArl['arlStatus']
          >,
        ),
      error: () => undefined,
    });
  }

  crear(): void {
    if (this.formulario.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    this.aviso.set('');
    const valores = this.formulario.getRawValue();
    // El backend rechaza cadenas vacías en los campos opcionales.
    const cuerpo = Object.fromEntries(
      Object.entries(valores).filter(([, valor]) => typeof valor === 'string' && valor.trim() !== ''),
    );
    this.http.post<Colaborador>('/api/collaborators', cuerpo).subscribe({
      next: (creado) => {
        this.aviso.set(`${creado.firstName} ${creado.lastName} quedó registrado. Ya puede ingresar con su PIN.`);
        this.formulario.reset(this.valoresIniciales);
        this.guardando.set(false);
        this.cargarColaboradores();
      },
      error: (respuesta: { status: number }) => {
        this.error.set(
          respuesta.status === 409
            ? 'Ya existe un colaborador con ese número de documento.'
            : 'No fue posible registrar al colaborador. Revisa los datos e intenta de nuevo.',
        );
        this.guardando.set(false);
      },
    });
  }

  arlDe(collaboratorId: string): string {
    return this.arlPorColaborador()[collaboratorId] ?? 'VENCIDA';
  }

  // ── Presentación ─────────────────────────────────────────
  fecha(valor: string | null): string {
    return fechaHora(valor);
  }

  soloFecha(valor: string): string {
    return fechaCalendario(valor);
  }

  claseArl(estado: string | undefined): string {
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    return 'vencida';
  }

  textoArl(estado: string | undefined): string {
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Próxima a vencer';
    return 'Vencida';
  }

  private formatearValor(valor: unknown): string {
    if (valor === null || valor === undefined || valor === '') return '—';
    if (Array.isArray(valor)) return valor.join(', ');
    if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
    return String(valor);
  }

  private cargarFirma(fileId: string): void {
    this.http.get(`/api/files/${fileId}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.liberarFirma();
        this.firmaUrl.set(URL.createObjectURL(blob));
      },
      error: () => undefined,
    });
  }

  private liberarFirma(): void {
    const url = this.firmaUrl();
    if (url) URL.revokeObjectURL(url);
    this.firmaUrl.set(null);
  }
}
