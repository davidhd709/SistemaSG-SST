import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthSessionService } from '../../core/auth-session.service';
import { diasHasta, fechaCalendario, textoVencimiento } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { RouterLink, RouterLinkActive } from '@angular/router';

type EstadoArl = 'VIGENTE' | 'PROXIMA_A_VENCER' | 'VENCIDA';

type Afiliacion = {
  id: string;
  providerName: string;
  startDate: string;
  endDate: string;
  arlStatus: EstadoArl;
};

type Fila = {
  collaborator: {
    id: string;
    documentNumber: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    jobTitle: string | null;
    team: string | null;
    status: string;
  };
  affiliation: Afiliacion | null;
  arlStatus: EstadoArl;
};

type Documento = { id: string; fileId: string; createdAt: string };
type AfiliacionHistorial = Afiliacion & { documents: Documento[] };

type CrearColaborador = {
  documentType: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  team: string;
  email: string;
  phone: string;
  pin: string;
};

/**
 * Puesto del Gestor de ARL. La especificación le pide registrar fechas,
 * actualizar afiliaciones, cargar soportes y consultar vencimientos: todo eso
 * ocurre aquí, sobre la misma lista desde la que detecta a quién le falta.
 */
@Component({
  imports: [ReactiveFormsModule, LogoutButtonComponent, RouterLink, RouterLinkActive],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <span class="sigla" aria-hidden="true">SST</span>
          <span class="nombre">
            Afiliaciones ARL
            <span class="lema">Vigencias y soportes</span>
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

      <section class="area-masthead" aria-labelledby="arl-titulo">
        <div>
          <h1 id="arl-titulo">Gestión de afiliaciones ARL</h1>
          <p>Controla vigencias, soportes y alertas de las afiliaciones de los colaboradores.</p>
        </div>
        <span class="area-contexto">Gestor ARL</span>
      </section>

      <nav class="modulos" aria-label="Gestión de requisitos">
        <a routerLink="/gestor-arl" routerLinkActive="activo" [routerLinkActiveOptions]="{ exact: true }">ARL</a>
        <a routerLink="/seguridad-social" routerLinkActive="activo">Seguridad social</a>
      </nav>

      @if (seleccionada(); as fila) {
        <!-- ══════════ Ficha del colaborador ══════════ -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}</h2>
            <button class="boton secundario compacto" type="button" (click)="cerrarFicha()">Volver a la lista</button>
          </div>
          <p class="secundario documento">
            {{ fila.collaborator.documentNumber }} ·
            <span class="distintivo" [class]="clasePorVencimiento(fila.affiliation?.endDate, fila.arlStatus)">{{
              texto(fila.arlStatus)
            }}</span>
          </p>

          <h3>Datos del colaborador</h3>
          <form [formGroup]="formularioEdicion" (ngSubmit)="actualizarColaborador()" class="rejilla-campos dos">
            <label class="campo ancho-total">
              <span>Número de documento</span>
              <input [value]="fila.collaborator.documentNumber" disabled />
              <span class="ayuda">El documento identifica al colaborador y no se modifica desde este formulario.</span>
            </label>
            <label class="campo"><span>Nombres</span><input formControlName="firstName" /></label>
            <label class="campo"><span>Apellidos</span><input formControlName="lastName" /></label>
            <label class="campo">
              <span>Cargo</span>
              <select formControlName="jobTitle">
                <option value="">Selecciona un cargo</option>
                <option value="Oficial eléctrico">Oficial eléctrico</option>
                <option value="Auxiliar eléctrico">Auxiliar eléctrico</option>
                <option value="Ayudante">Ayudante</option>
                <option value="Supervisor">Supervisor</option>
              </select>
            </label>
            <label class="campo"><span>Equipo</span><input formControlName="team" placeholder="Opcional" /></label>
            <label class="campo"><span>Correo</span><input formControlName="email" type="email" placeholder="Opcional" /></label>
            <label class="campo"><span>Teléfono</span><input formControlName="phone" inputmode="tel" placeholder="Opcional" /></label>
            @if (requierePinEdicion()) {
              <label class="campo ancho-total">
                <span>PIN de acceso del Oficial eléctrico</span>
                <input formControlName="pin" type="password" inputmode="numeric" autocomplete="new-password" />
                <span class="ayuda">
                  {{ pinObligatorioEdicion() ? 'Asigna un PIN de 4 a 12 caracteres para habilitar su acceso.' : 'Déjalo vacío para conservar el PIN actual.' }}
                </span>
              </label>
            }
            <div class="acciones ancho-total">
              <button class="boton" [disabled]="formularioEdicion.invalid || actualizandoColaborador()">
                {{ actualizandoColaborador() ? 'Guardando…' : 'Guardar datos del colaborador' }}
              </button>
            </div>
          </form>

          <h3>{{ fila.affiliation ? 'Actualizar afiliación vigente' : 'Registrar primera afiliación' }}</h3>
          <form [formGroup]="formulario" (ngSubmit)="guardar()" class="rejilla-campos dos">
            <label class="campo ancho-total">
              <span>Administradora de riesgos laborales</span>
              <input formControlName="providerName" autocomplete="off" placeholder="Por ejemplo, ARL Sura" />
            </label>
            <label class="campo">
              <span>Inicio de vigencia</span>
              <input type="date" formControlName="startDate" />
            </label>
            <label class="campo">
              <span>Fin de vigencia</span>
              <input type="date" formControlName="endDate" />
            </label>
            @if (rangoInvalido()) {
              <p class="mensaje error ancho-total">La fecha de fin debe ser igual o posterior a la de inicio.</p>
            }
            <div class="acciones ancho-total">
              <button class="boton" [disabled]="formulario.invalid || rangoInvalido() || guardando()">
                {{ guardando() ? 'Guardando…' : fila.affiliation ? 'Actualizar vigencia' : 'Registrar afiliación' }}
              </button>
            </div>
          </form>

          @if (fila.affiliation) {
            <h3>Cargar soporte</h3>
            <p class="secundario">
              Certificado de afiliación o planilla en PDF, JPG o PNG. Máximo 10 MB. Queda registrado en la auditoría.
            </p>
            <div class="acciones carga">
              <input
                #archivo
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                (change)="elegirArchivo($event)"
              />
              <button class="boton compacto" type="button" [disabled]="!seleccionado() || subiendo()" (click)="subir()">
                {{ subiendo() ? 'Cargando…' : 'Cargar soporte' }}
              </button>
            </div>
          }

          <h3>Historial de afiliaciones</h3>
          @if (historial().length) {
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Administradora</th>
                    <th>Vigencia</th>
                    <th>Estado</th>
                    <th>Soportes</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of historial(); track item.id) {
                    <tr>
                      <td>{{ item.providerName }}</td>
                      <td>
                        {{ soloFecha(item.startDate) }}
                        <span class="secundario">hasta {{ soloFecha(item.endDate) }}</span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="clasePorVencimiento(item.endDate, item.arlStatus)">{{
                          texto(item.arlStatus)
                        }}</span>
                      </td>
                      <td>
                        @if (item.documents.length) {
                          <div class="soportes">
                            @for (documento of item.documents; track documento.id; let i = $index) {
                              <button
                                class="boton secundario compacto"
                                type="button"
                                (click)="descargar(documento.fileId)"
                              >
                                Soporte {{ i + 1 }}
                              </button>
                            }
                          </div>
                        } @else {
                          <span class="secundario">Sin soportes</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="secundario">Todavía no hay afiliaciones registradas.</p>
          }
        </section>
      } @else {
        <!-- ══════════ Lista ══════════ -->
        <div class="titulo-seccion">
          <div>
            <h2>Colaboradores y afiliaciones</h2>
            <span class="secundario">Registra colaboradores y administra su vigencia ARL.</span>
          </div>
          <button class="boton compacto" type="button" (click)="alternarRegistroColaborador()">
            {{ mostrandoRegistro() ? 'Cerrar registro' : '+ Registrar colaborador' }}
          </button>
        </div>

        @if (mostrandoRegistro()) {
          <section class="bloque registro-colaborador">
            <div class="titulo-seccion"><h3>Nuevo colaborador</h3></div>
            <form [formGroup]="formularioColaborador" (ngSubmit)="crearColaborador()" class="rejilla-campos dos">
              <label class="campo"
                ><span>Tipo de documento</span
                ><select formControlName="documentType">
                  <option value="CC">Cédula de ciudadanía</option>
                  <option value="CE">Cédula de extranjería</option>
                  <option value="PA">Pasaporte</option>
                  <option value="PEP">Permiso especial de permanencia</option>
                </select></label
              >
              <label class="campo"
                ><span>Número de documento</span><input formControlName="documentNumber" inputmode="numeric"
              /></label>
              <label class="campo"><span>Nombres</span><input formControlName="firstName" /></label>
              <label class="campo"><span>Apellidos</span><input formControlName="lastName" /></label>
              <label class="campo"
                ><span>Cargo</span
                ><select formControlName="jobTitle">
                  <option value="">Selecciona un cargo</option>
                  <option value="Oficial eléctrico">Oficial eléctrico</option>
                  <option value="Auxiliar eléctrico">Auxiliar eléctrico</option>
                  <option value="Ayudante">Ayudante</option>
                  <option value="Supervisor">Supervisor</option>
                </select></label
              >
              <label class="campo"><span>Equipo</span><input formControlName="team" placeholder="Opcional" /></label>
              <label class="campo"
                ><span>Correo</span><input formControlName="email" type="email" placeholder="Opcional"
              /></label>
              <label class="campo"
                ><span>Teléfono</span><input formControlName="phone" inputmode="tel" placeholder="Opcional"
              /></label>
              @if (requierePin()) {
                <label class="campo ancho-total"
                  ><span>PIN de acceso del Oficial eléctrico</span
                  ><input formControlName="pin" inputmode="numeric" /><span class="ayuda"
                    >Entre 4 y 12 caracteres. Es la única persona que ingresa para iniciar el permiso de la
                    cuadrilla.</span
                  ></label
                >
              } @else {
                <p class="ayuda ancho-total">
                  Este cargo no requiere PIN y no podrá iniciar permisos desde el celular.
                </p>
              }
              <div class="acciones ancho-total">
                <button class="boton" [disabled]="formularioColaborador.invalid || creandoColaborador()">
                  {{ creandoColaborador() ? 'Registrando…' : 'Registrar colaborador' }}
                </button>
              </div>
            </form>
          </section>
        }

        <section class="indicadores">
          <div class="indicador">
            <span class="cifra">{{ conteo('VIGENTE') }}</span>
            <span class="rotulo">Vigentes</span>
          </div>
          <div class="indicador" [class.atencion]="conteo('PROXIMA_A_VENCER') > 0">
            <span class="cifra">{{ conteo('PROXIMA_A_VENCER') }}</span>
            <span class="rotulo">Próximas a vencer</span>
          </div>
          <div class="indicador" [class.atencion]="conteo('VENCIDA') > 0">
            <span class="cifra">{{ conteo('VENCIDA') }}</span>
            <span class="rotulo">Vencidas o sin afiliación</span>
          </div>
        </section>

        <div class="titulo-seccion lista-arl-cabecera">
          <h2>
            Colaboradores
            <span class="conteo">({{ visibles().length }} de {{ filas().length }})</span>
          </h2>
          <button class="boton secundario compacto" type="button" (click)="cargar()">Actualizar</button>
        </div>

        <div class="pestanas" role="tablist">
          @for (opcion of filtros; track opcion.valor) {
            <button
              role="tab"
              type="button"
              [attr.aria-selected]="filtro() === opcion.valor"
              (click)="filtro.set(opcion.valor)"
            >
              {{ opcion.etiqueta }}
              <span class="globo">{{ opcion.valor ? conteo(opcion.valor) : filas().length }}</span>
            </button>
          }
        </div>

        @if (cargando()) {
          <p class="secundario">Consultando afiliaciones…</p>
        } @else if (visibles().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Administradora</th>
                  <th>Vence</th>
                  <th>Estado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (fila of visibles(); track fila.collaborator.id) {
                  <tr>
                    <td>
                      <strong>{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}</strong>
                      <span class="secundario">{{ fila.collaborator.documentNumber }}</span>
                    </td>
                    <td>{{ fila.affiliation?.providerName || '—' }}</td>
                    <td>
                      @if (fila.affiliation) {
                        {{ soloFecha(fila.affiliation.endDate) }}
                        <span class="secundario">{{ vencimiento(fila.affiliation.endDate) }}</span>
                      } @else {
                        <span class="secundario">Sin afiliación</span>
                      }
                    </td>
                    <td>
                      <span
                        class="distintivo"
                        [class]="clasePorVencimiento(fila.affiliation?.endDate, fila.arlStatus)"
                        >{{ texto(fila.arlStatus) }}</span
                      >
                    </td>
                    <td>
                      <button class="boton compacto" type="button" (click)="abrirFicha(fila)">
                        {{ fila.affiliation ? 'Gestionar' : 'Registrar' }}
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="vacio">
            <strong>No hay colaboradores en este estado</strong>
            Cambia el filtro para ver los demás.
          </p>
        }
      }
    </main>
  `,
  styles: [
    `
      h3 {
        margin: 28px 0 10px;
        font-size: 1.0625rem;
      }
      .secundario {
        display: block;
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }
      .documento {
        margin: -8px 0 4px;
      }
      .documento .distintivo {
        font-size: 0.75rem;
      }
      .carga {
        align-items: center;
      }
      .carga input[type='file'] {
        flex: 1 1 260px;
        min-height: 46px;
        padding: 9px 12px;
        font-size: 0.9375rem;
      }
      .soportes {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .registro-colaborador {
        margin-bottom: 24px;
        background: #f7fbf8;
      }
      .registro-colaborador h3 {
        margin: 0;
      }
      .lista-arl-cabecera {
        margin-top: 28px;
      }
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
        max-width: 68ch;
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
      .distintivo.urgencia-5 {
        background: #fff3d6;
        border-color: #edd38f;
        color: #875300;
      }
      .distintivo.urgencia-3 {
        background: #ffe4c1;
        border-color: #e7ad63;
        color: #974500;
      }
      .distintivo.urgencia-1 {
        background: #fbd8d4;
        border-color: #dc8077;
        color: #a1261e;
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
export class ArlListComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);

  readonly filas = signal<Fila[]>([]);
  readonly historial = signal<AfiliacionHistorial[]>([]);
  readonly seleccionada = signal<Fila | null>(null);
  readonly filtro = signal<EstadoArl | null>(null);
  readonly cargando = signal(false);
  readonly guardando = signal(false);
  readonly subiendo = signal(false);
  readonly seleccionado = signal<File | null>(null);
  readonly mostrandoRegistro = signal(false);
  readonly creandoColaborador = signal(false);
  readonly actualizandoColaborador = signal(false);
  readonly cargoOriginalEdicion = signal('');
  readonly error = signal('');
  readonly aviso = signal('');

  readonly filtros: { valor: EstadoArl | null; etiqueta: string }[] = [
    { valor: null, etiqueta: 'Todos' },
    { valor: 'VENCIDA', etiqueta: 'Vencidas' },
    { valor: 'PROXIMA_A_VENCER', etiqueta: 'Por vencer' },
    { valor: 'VIGENTE', etiqueta: 'Vigentes' },
  ];

  readonly formulario = this.fb.nonNullable.group({
    providerName: ['', [Validators.required, Validators.maxLength(150)]],
    startDate: ['', Validators.required],
    endDate: ['', Validators.required],
  });
  readonly valoresColaborador: CrearColaborador = {
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
  readonly formularioColaborador = this.fb.nonNullable.group({
    documentType: ['CC', Validators.required],
    documentNumber: ['', [Validators.required, Validators.pattern(/^[0-9A-Za-z-]{5,30}$/)]],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    jobTitle: ['', Validators.required],
    team: ['', Validators.maxLength(100)],
    email: ['', Validators.email],
    phone: ['', Validators.maxLength(30)],
    pin: [''],
  });
  readonly formularioEdicion = this.fb.nonNullable.group({
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    jobTitle: ['', Validators.required],
    team: ['', Validators.maxLength(100)],
    email: ['', Validators.email],
    phone: ['', Validators.maxLength(30)],
    pin: [''],
  });

  readonly visibles = computed(() => {
    const estado = this.filtro();
    return estado ? this.filas().filter((fila) => fila.arlStatus === estado) : this.filas();
  });

  constructor() {
    this.cargar();
    this.formularioColaborador.controls.jobTitle.valueChanges.subscribe(() => this.actualizarReglaPin());
    this.formularioEdicion.controls.jobTitle.valueChanges.subscribe(() => this.actualizarReglaPinEdicion());
  }

  requierePin(): boolean {
    return this.formularioColaborador.controls.jobTitle.value === 'Oficial eléctrico';
  }

  private actualizarReglaPin(): void {
    const pin = this.formularioColaborador.controls.pin;
    if (this.requierePin()) pin.setValidators([Validators.required, Validators.minLength(4), Validators.maxLength(12)]);
    else {
      pin.clearValidators();
      pin.setValue('', { emitEvent: false });
    }
    pin.updateValueAndValidity({ emitEvent: false });
  }

  requierePinEdicion(): boolean {
    return this.formularioEdicion.controls.jobTitle.value === 'Oficial eléctrico';
  }

  pinObligatorioEdicion(): boolean {
    return this.requierePinEdicion() && this.cargoOriginalEdicion() !== 'Oficial eléctrico';
  }

  private actualizarReglaPinEdicion(): void {
    const pin = this.formularioEdicion.controls.pin;
    if (this.requierePinEdicion()) {
      pin.setValidators([
        ...(this.pinObligatorioEdicion() ? [Validators.required] : []),
        Validators.minLength(4),
        Validators.maxLength(12),
      ]);
    }
    else {
      pin.clearValidators();
      pin.setValue('', { emitEvent: false });
    }
    pin.updateValueAndValidity({ emitEvent: false });
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.http.get<Fila[]>('/api/arl').subscribe({
      next: (filas) => {
        this.filas.set(filas);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No fue posible consultar las afiliaciones o no tienes permiso.');
        this.cargando.set(false);
      },
    });
  }

  alternarRegistroColaborador(): void {
    this.mostrandoRegistro.update((valor) => !valor);
  }

  crearColaborador(): void {
    if (this.formularioColaborador.invalid) return;
    this.creandoColaborador.set(true);
    this.error.set('');
    const valores = this.formularioColaborador.getRawValue();
    const cuerpo = Object.fromEntries(
      Object.entries(valores).filter(([, valor]) => typeof valor !== 'string' || valor.trim() !== ''),
    );
    this.http.post('/api/collaborators', cuerpo).subscribe({
      next: () => {
        this.aviso.set('Colaborador registrado. Ahora puedes crear o actualizar su afiliación ARL.');
        this.formularioColaborador.reset(this.valoresColaborador);
        this.mostrandoRegistro.set(false);
        this.creandoColaborador.set(false);
        this.cargar();
      },
      error: (respuesta: { status: number }) => {
        this.error.set(
          respuesta.status === 409
            ? 'Ya existe un colaborador con ese documento.'
            : 'No fue posible registrar el colaborador.',
        );
        this.creandoColaborador.set(false);
      },
    });
  }

  conteo(estado: EstadoArl): number {
    return this.filas().filter((fila) => fila.arlStatus === estado).length;
  }

  abrirFicha(fila: Fila): void {
    this.seleccionada.set(fila);
    this.aviso.set('');
    this.seleccionado.set(null);
    this.formulario.reset({
      providerName: fila.affiliation?.providerName ?? '',
      startDate: fila.affiliation?.startDate?.slice(0, 10) ?? '',
      endDate: fila.affiliation?.endDate?.slice(0, 10) ?? '',
    });
    this.cargoOriginalEdicion.set(fila.collaborator.jobTitle ?? '');
    this.formularioEdicion.reset({
      firstName: fila.collaborator.firstName,
      lastName: fila.collaborator.lastName,
      jobTitle: fila.collaborator.jobTitle ?? '',
      team: fila.collaborator.team ?? '',
      email: fila.collaborator.email ?? '',
      phone: fila.collaborator.phone ?? '',
      pin: '',
    });
    this.actualizarReglaPinEdicion();
    this.cargarHistorial(fila.collaborator.id);
    globalThis.scrollTo({ top: 0 });
  }

  cerrarFicha(): void {
    this.seleccionada.set(null);
    this.historial.set([]);
    this.seleccionado.set(null);
  }

  actualizarColaborador(): void {
    const fila = this.seleccionada();
    if (!fila || this.formularioEdicion.invalid) return;
    this.actualizandoColaborador.set(true);
    this.error.set('');
    const valores = this.formularioEdicion.getRawValue();
    const { pin, ...datos } = valores;
    const cuerpo = { ...datos, ...(pin.trim() ? { pin: pin.trim() } : {}) };
    this.http.patch(`/api/collaborators/${fila.collaborator.id}`, cuerpo).subscribe({
      next: () => {
        this.aviso.set('Datos del colaborador actualizados. El cambio quedó registrado en la auditoría.');
        this.actualizandoColaborador.set(false);
        this.refrescarFicha(fila.collaborator.id);
      },
      error: () => {
        this.error.set('No fue posible actualizar los datos del colaborador. Revisa la información e inténtalo de nuevo.');
        this.actualizandoColaborador.set(false);
      },
    });
  }

  rangoInvalido(): boolean {
    const { startDate, endDate } = this.formulario.getRawValue();
    return Boolean(startDate && endDate && endDate < startDate);
  }

  guardar(): void {
    const fila = this.seleccionada();
    if (!fila || this.formulario.invalid || this.rangoInvalido()) return;
    this.guardando.set(true);
    this.error.set('');
    const valores = this.formulario.getRawValue();

    // Sin afiliación previa se crea; con ella se corrige la vigencia vigente.
    const peticion = fila.affiliation
      ? this.http.patch<Afiliacion>(`/api/arl/affiliations/${fila.affiliation.id}`, valores)
      : this.http.post<Afiliacion>('/api/arl/affiliations', { ...valores, collaboratorId: fila.collaborator.id });

    peticion.subscribe({
      next: () => {
        this.aviso.set(
          fila.affiliation
            ? 'Vigencia actualizada. El cambio quedó registrado en la auditoría.'
            : 'Afiliación registrada. El colaborador ya puede diligenciar su permiso.',
        );
        this.guardando.set(false);
        this.refrescarFicha(fila.collaborator.id);
      },
      error: () => {
        this.error.set('No fue posible guardar la afiliación. Revisa las fechas e intenta de nuevo.');
        this.guardando.set(false);
      },
    });
  }

  elegirArchivo(evento: Event): void {
    const entrada = evento.target as HTMLInputElement;
    this.seleccionado.set(entrada.files?.[0] ?? null);
    this.error.set('');
  }

  subir(): void {
    const fila = this.seleccionada();
    const archivo = this.seleccionado();
    if (!fila?.affiliation || !archivo) return;
    if (archivo.size > 10 * 1024 * 1024) {
      this.error.set('El soporte supera los 10 MB permitidos.');
      return;
    }
    this.subiendo.set(true);
    this.error.set('');
    const cuerpo = new FormData();
    cuerpo.append('file', archivo);
    // Sin Content-Type explícito: el navegador debe añadir su propio separador.
    this.http.post(`/api/arl/affiliations/${fila.affiliation.id}/documents`, cuerpo).subscribe({
      next: () => {
        this.aviso.set('Soporte cargado y asociado a la afiliación.');
        this.subiendo.set(false);
        this.seleccionado.set(null);
        this.cargarHistorial(fila.collaborator.id);
      },
      error: () => {
        this.error.set('No fue posible cargar el soporte. Debe ser PDF, JPG o PNG de máximo 10 MB.');
        this.subiendo.set(false);
      },
    });
  }

  descargar(fileId: string): void {
    this.http.get(`/api/files/${fileId}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = 'soporte-arl';
        enlace.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el soporte.'),
    });
  }

  soloFecha(valor: string): string {
    return fechaCalendario(valor);
  }

  /** Días restantes en texto: el gestor prioriza por urgencia, no por fecha. */
  vencimiento(endDate: string): string {
    return textoVencimiento(endDate);
  }

  clase(estado: EstadoArl): string {
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    return 'vencida';
  }

  /** Entre cinco y tres días se advierte; los últimos dos se hacen más visibles. */
  clasePorVencimiento(endDate: string | undefined, estado: EstadoArl): string {
    if (estado !== 'PROXIMA_A_VENCER' || !endDate) return this.clase(estado);
    const dias = Math.max(0, diasHasta(endDate));
    if (dias <= 1) return 'por-vencer urgencia-1';
    if (dias <= 3) return 'por-vencer urgencia-3';
    return 'por-vencer urgencia-5';
  }

  texto(estado: EstadoArl): string {
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Próxima a vencer';
    return 'Vencida';
  }

  private cargarHistorial(collaboratorId: string): void {
    this.http.get<AfiliacionHistorial[]>(`/api/arl/collaborators/${collaboratorId}/history`).subscribe({
      next: (historial) => this.historial.set(historial),
      error: () => this.historial.set([]),
    });
  }

  /** Tras guardar, la lista y la ficha deben reflejar el estado recalculado. */
  private refrescarFicha(collaboratorId: string): void {
    this.http.get<Fila[]>('/api/arl').subscribe({
      next: (filas) => {
        this.filas.set(filas);
        const actualizada = filas.find((fila) => fila.collaborator.id === collaboratorId);
        if (actualizada) this.seleccionada.set(actualizada);
        this.cargarHistorial(collaboratorId);
      },
      error: () => undefined,
    });
  }
}
