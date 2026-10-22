import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { fechaHora } from '../../core/fechas';

type Rol = { code: string; name: string; permissions: { permission: { code: string } }[] };
type Cargo = { id: string; code: string; name: string; canLead: boolean };

type Evento = {
  id: string;
  actorUserId: string | null;
  actorCollaboratorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  beforeJson: unknown;
  afterJson: unknown;
  ip: string | null;
  userAgent: string | null;
  correlationId: string;
  createdAt: string;
  actorUser?: { email: string } | null;
  actorCollaborator?: { firstName: string; lastName: string } | null;
};

type Formulario = {
  code: string;
  name: string;
  description: string | null;
  versionNumber: number;
  schemaJson: { fields: { id: string; label: string; type: string; required: boolean; section?: string }[] };
};

type Usuario = {
  id: string;
  email: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  lastAccessAt: string | null;
  roles: { code: string; name: string }[];
};

type Colaborador = {
  id: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  jobPositionId: string | null;
  jobPosition: Cargo | null;
  team: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
};

type Cuenta = {
  id: string;
  tipo: 'INTERNO' | 'COLABORADOR';
  nombre: string;
  email: string;
  detalle: string;
  status: 'ACTIVE' | 'INACTIVE';
  ultimoAcceso: string | null;
  usuario?: Usuario;
  colaborador?: Colaborador;
};

type Pestana = 'inicio' | 'accesos' | 'auditoria' | 'formularios';

/** Cómo se lee cada acción registrada, para no mostrar el código en crudo. */
const ACCIONES: Record<string, string> = {
  LOGIN_SUCCEEDED: 'Ingreso administrativo',
  LOGIN_FAILED: 'Ingreso administrativo fallido',
  COLLABORATOR_LOGIN_SUCCEEDED: 'Ingreso de colaborador',
  COLLABORATOR_LOGIN_FAILED: 'Ingreso de colaborador fallido',
  CREATE_USER: 'Usuario creado',
  UPDATE_USER: 'Usuario actualizado',
  CREATE_COLLABORATOR: 'Colaborador creado',
  UPDATE_COLLABORATOR: 'Colaborador actualizado',
  CREATE_ARL_AFFILIATION: 'Afiliación ARL registrada',
  UPDATE_ARL_AFFILIATION: 'Afiliación ARL actualizada',
  UPLOAD_ARL_DOCUMENT: 'Soporte de ARL cargado',
  SUBMIT_FORM: 'Permiso enviado',
  APPROVE_SUBMISSION: 'Permiso autorizado',
  REJECT_SUBMISSION: 'Permiso rechazado',
  GENERATE_FINAL_PDF: 'PDF final generado',
  DOWNLOAD_FILE: 'Documento descargado',
};

const ENTIDADES: Record<string, string> = {
  USER: 'Usuario',
  COLLABORATOR: 'Colaborador',
  ARL_AFFILIATION: 'Afiliación ARL',
  FORM_SUBMISSION: 'Permiso',
  FILE_OBJECT: 'Documento',
};

/**
 * Consola de administración. Reúne lo que la especificación asigna al rol:
 * cuentas y permisos, la auditoría del sistema y el formato publicado.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink, LogoutButtonComponent],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <a
          class="marca"
          routerLink="/administracion/panel"
          (click)="ver('inicio')"
          aria-label="Ir al resumen de Administración"
        >
          <img class="sigla" src="assets/marca/marca-clara.png" alt="" width="40" height="40" /><span class="sello"
            >Gestión SST</span
          >
          <span class="nombre">Administración<span class="lema">Cuentas, auditoría y formatos</span></span>
        </a>
        <sg-logout-button />
      </div>
    </header>

    <main class="app-contenido">
      <section class="area-masthead" aria-labelledby="admin-titulo">
        <div>
          <h1 id="admin-titulo">Administración del sistema</h1>
          <p>Gestiona cuentas internas, consulta la trazabilidad y revisa los formatos publicados.</p>
        </div>

        <div class="pestanas" role="tablist" aria-label="Secciones de Administración">
          <button role="tab" type="button" [attr.aria-selected]="pestana() === 'inicio'" (click)="ver('inicio')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="3" width="7" height="9" rx="1.5" />
              <rect x="14" y="3" width="7" height="5" rx="1.5" />
              <rect x="14" y="12" width="7" height="9" rx="1.5" />
              <rect x="3" y="16" width="7" height="5" rx="1.5" />
            </svg>
            Resumen
          </button>
          <button role="tab" type="button" [attr.aria-selected]="pestana() === 'accesos'" (click)="ver('accesos')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19" />
              <circle cx="9.5" cy="7" r="3.2" />
              <path d="M17 8h4m-2-2v4" />
            </svg>
            Cuentas y permisos
          </button>
          <button role="tab" type="button" [attr.aria-selected]="pestana() === 'auditoria'" (click)="ver('auditoria')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h12M4 12h8m-8 7h12" />
              <circle cx="18" cy="5" r="2" />
              <circle cx="14" cy="12" r="2" />
              <circle cx="18" cy="19" r="2" />
            </svg>
            Auditoría
            @if (eventos().length) {
              <span class="globo">{{ eventos().length }}</span>
            }
          </button>
          <button
            role="tab"
            type="button"
            [attr.aria-selected]="pestana() === 'formularios'"
            (click)="ver('formularios')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 3h8l4 4v14H6z" />
              <path d="M14 3v5h5M9 13h6m-6 4h6" />
            </svg>
            Formatos
          </button>
        </div>
      </section>

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      @if (aviso()) {
        <p class="mensaje ok" role="status">{{ aviso() }}</p>
      }

      @if (pestana() === 'inicio') {
        <section class="admin-inicio" aria-label="Resumen administrativo">
          <div class="admin-resumen-grid">
            <section class="bloque admin-accesos-rapidos" aria-labelledby="accesos-rapidos-titulo">
              <h2 id="accesos-rapidos-titulo">Accesos rápidos</h2>
              <button type="button" (click)="ver('accesos')">
                Crear usuario
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
              <button type="button" (click)="ver('formularios')">
                Revisar formato
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
              <button type="button" (click)="ver('auditoria')">
                Consultar auditoría
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </section>
            <section class="bloque admin-estado" aria-labelledby="estado-titulo">
              <div class="titulo-seccion">
                <h2 id="estado-titulo">Estado del sistema</h2>
                <span class="distintivo vigente">Disponible</span>
              </div>
              <ul>
                <li><span>Acceso administrativo protegido</span><small>Activo</small></li>
                <li>
                  <span>Roles y permisos cargados</span
                  ><small>{{ roles().length ? roles().length + ' roles' : 'Cargando' }}</small>
                </li>
                <li>
                  <span>Formato publicado</span
                  ><small>{{ formato() ? formato()!.code + ' · v' + formato()!.versionNumber : 'Cargando' }}</small>
                </li>
                <li>
                  <span>Registro de trazabilidad</span
                  ><small>{{ eventos().length ? 'Disponible' : 'Sin datos' }}</small>
                </li>
              </ul>
            </section>
          </div>

          <section class="bloque admin-actividad" aria-labelledby="actividad-titulo">
            <div class="titulo-seccion">
              <h2 id="actividad-titulo">Actividad reciente</h2>
              <button class="boton secundario compacto" type="button" (click)="ver('auditoria')">
                Ver auditoría completa
              </button>
            </div>
            @if (eventos().length) {
              <ol>
                @for (evento of eventos().slice(0, 5); track evento.id) {
                  <li [class.fallo]="esFallo(evento)">
                    <span class="evento-etiqueta" [class.evento-alerta]="esFallo(evento)">{{
                      nombreAccion(evento.action)
                    }}</span>
                    <span class="actor">{{ nombreActor(evento) }}</span>
                    <time class="momento">{{ momento(evento.createdAt) }}</time>
                  </li>
                }
              </ol>
            } @else {
              <p class="secundario">Todavía no hay eventos registrados.</p>
            }
          </section>
        </section>
      }

      <!-- ══════════ Cuentas y permisos ══════════ -->
      @if (pestana() === 'accesos') {
        <div class="admin-cuentas">
          <div class="usuarios-cabecera">
            <div>
              <h2>Gestión de usuarios</h2>
              <p>Administra las cuentas internas con acceso al sistema.</p>
            </div>
            <button class="boton compacto" type="button" (click)="alternarFormularioUsuario()">
              @if (mostrarCrear()) {
                Cerrar formulario
              } @else {
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                Crear usuario
              }
            </button>
          </div>

          @if (cuentaEditando(); as cuenta) {
            <section class="bloque editar-usuario">
              <div class="titulo-seccion">
                <div>
                  <h3>Editar {{ cuenta.tipo === 'INTERNO' ? 'usuario interno' : 'colaborador' }}</h3>
                  <span class="secundario">{{ cuenta.nombre }}</span>
                </div>
                <button class="boton secundario compacto" type="button" (click)="cuentaEditando.set(null)">
                  Cancelar
                </button>
              </div>
              <form [formGroup]="formularioEdicion" (ngSubmit)="guardarEdicion()" class="rejilla-campos dos">
                @if (cuenta.tipo === 'COLABORADOR') {
                  <label class="campo"><span>Nombres</span><input formControlName="firstName" /></label>
                  <label class="campo"><span>Apellidos</span><input formControlName="lastName" /></label>
                  <label class="campo"><span>Teléfono</span><input formControlName="phone" /></label>
                  <label class="campo"
                    ><span>Cargo</span
                    ><select formControlName="jobPositionId">
                      <option value="">Sin cargo</option>
                      @for (cargo of cargos(); track cargo.id) {
                        <option [value]="cargo.id">{{ cargo.name }}</option>
                      }
                    </select></label
                  >
                  <label class="campo ancho-total"><span>Equipo</span><input formControlName="team" /></label>
                }
                <label class="campo"><span>Correo</span><input formControlName="email" type="email" /></label>
                <label class="campo"
                  ><span>Estado</span
                  ><select formControlName="status">
                    <option value="ACTIVE">Activo</option>
                    <option value="INACTIVE">Inactivo</option>
                  </select></label
                >
                @if (cuenta.tipo === 'INTERNO') {
                  <label class="campo ancho-total"
                    ><span>Nueva contraseña <small>(opcional)</small></span
                    ><input formControlName="password" type="password" autocomplete="new-password"
                  /></label>
                  <div class="campo ancho-total">
                    <span id="roles-edicion">Roles asignados</span>
                    <div class="casillas" role="group" aria-labelledby="roles-edicion">
                      @for (rol of roles(); track rol.code) {
                        <label class="casilla"
                          ><input
                            type="checkbox"
                            [checked]="tieneRol(rol.code)"
                            (change)="alternarRol(rol.code)"
                          /><span>{{ rol.name }}</span></label
                        >
                      }
                    </div>
                  </div>
                }
                <div class="acciones ancho-total">
                  <button class="boton" [disabled]="guardando()">
                    {{ guardando() ? 'Guardando…' : 'Guardar cambios' }}
                  </button>
                </div>
              </form>
            </section>
          }

          @if (mostrarCrear()) {
            <section class="bloque crear-usuario">
              <div class="titulo-seccion"><h3>Nuevo usuario administrativo</h3></div>
              <p class="secundario introduccion">
                Se crea con contraseña temporal y deberá cambiarla en el primer ingreso.
              </p>
              <form [formGroup]="formulario" (ngSubmit)="crearUsuario()" class="rejilla-campos dos">
                <label class="campo">
                  <span>Correo institucional</span>
                  <input formControlName="email" type="email" autocomplete="off" />
                </label>
                <label class="campo">
                  <span>Contraseña temporal</span>
                  <input formControlName="password" type="text" autocomplete="off" />
                  <span class="ayuda">Mínimo 12 caracteres. Entrégala por un canal seguro.</span>
                </label>

                <div class="campo ancho-total">
                  <span id="roles-etiqueta">Roles asignados</span>
                  <div class="casillas" role="group" aria-labelledby="roles-etiqueta">
                    @for (rol of roles(); track rol.code) {
                      <label class="casilla">
                        <input type="checkbox" [checked]="tieneRol(rol.code)" (change)="alternarRol(rol.code)" />
                        <span>
                          {{ rol.name }}
                          <span class="secundario">{{ permisos(rol).length }} permisos</span>
                        </span>
                      </label>
                    }
                  </div>
                  @if (!seleccionados().length) {
                    <span class="ayuda">Selecciona al menos un rol.</span>
                  }
                </div>

                <div class="acciones ancho-total">
                  <button class="boton" [disabled]="formulario.invalid || !seleccionados().length || guardando()">
                    {{ guardando() ? 'Creando…' : 'Crear usuario' }}
                  </button>
                </div>
              </form>
            </section>
          }

          <section class="usuarios-tabla" aria-label="Usuarios internos">
            <div class="usuarios-herramientas">
              <label class="buscador-usuarios">
                <span class="sr-only">Buscar usuario</span>
                <input
                  [value]="busqueda()"
                  (input)="busqueda.set($any($event.target).value)"
                  placeholder="Buscar por correo o rol…"
                  type="search"
                />
              </label>
              <span>{{ cuentasVisibles().length }} cuentas</span>
            </div>
            @if (cuentasVisibles().length) {
              <div class="tabla-scroll">
                <table class="datos usuarios-datos">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Rol / cargo</th>
                      <th>Estado</th>
                      <th>Último acceso</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (cuenta of cuentasVisibles(); track cuenta.tipo + cuenta.id) {
                      <tr>
                        <td>
                          <span class="avatar-usuario">{{ iniciales(cuenta.nombre) }}</span
                          ><strong>{{ cuenta.nombre }}</strong
                          ><span class="secundario">{{ cuenta.email }}</span>
                        </td>
                        <td>{{ cuenta.detalle }}</td>
                        <td>
                          <span
                            class="distintivo"
                            [class.vigente]="cuenta.status === 'ACTIVE'"
                            [class.neutro]="cuenta.status !== 'ACTIVE'"
                            >{{ cuenta.status === 'ACTIVE' ? 'Activo' : 'Inactivo' }}</span
                          >
                        </td>
                        <td>{{ cuenta.ultimoAcceso ? momento(cuenta.ultimoAcceso) : 'Sin acceso registrado' }}</td>
                        <td>
                          <button class="editar-cuenta" type="button" (click)="editarCuenta(cuenta)">Editar</button>
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <p class="vacio">
                <strong>No hay cuentas para mostrar</strong
                >{{
                  busqueda()
                    ? 'Cambia la búsqueda para ver otros resultados.'
                    : 'Crea el primer usuario administrativo o registra un colaborador.'
                }}
              </p>
            }
          </section>
        </div>
      }

      <!-- ══════════ Auditoría ══════════ -->
      @if (pestana() === 'auditoria') {
        <div class="auditoria-cabecera">
          <div>
            <h2>Registro de auditoría</h2>
            <p>Trazabilidad inmutable de los eventos del sistema.</p>
          </div>
          <button class="boton secundario compacto" type="button" (click)="cargarAuditoria()">Actualizar</button>
        </div>

        <div class="auditoria-filtros">
          <label class="campo">
            <span class="sr-only">Filtrar por acción</span>
            <select [value]="filtroAccion()" (change)="filtroAccion.set($any($event.target).value)">
              <option value="">Todas las acciones</option>
              @for (accion of accionesPresentes(); track accion) {
                <option [value]="accion">{{ nombreAccion(accion) }}</option>
              }
            </select>
          </label>
          <label class="campo">
            <span class="sr-only">Filtrar por tipo de registro</span>
            <select [value]="filtroEntidad()" (change)="filtroEntidad.set($any($event.target).value)">
              <option value="">Todos los registros</option>
              @for (entidad of entidadesPresentes(); track entidad) {
                <option [value]="entidad">{{ nombreEntidad(entidad) }}</option>
              }
            </select>
          </label>
        </div>

        @if (visibles().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Fecha / hora</th>
                  <th>Evento</th>
                  <th>Usuario</th>
                  <th>Detalle</th>
                  <th>Origen / IP</th>
                </tr>
              </thead>
              <tbody>
                @for (evento of visibles(); track evento.id) {
                  <tr [class.fila-alerta]="esFallo(evento)">
                    <td class="momento">{{ momento(evento.createdAt) }}</td>
                    <td>
                      <span class="evento-etiqueta" [class.evento-alerta]="esFallo(evento)">{{
                        nombreAccion(evento.action)
                      }}</span>
                    </td>
                    <td>{{ nombreActor(evento) }}</td>
                    <td>{{ evento.reason || nombreEntidad(evento.entityType) }}</td>
                    <td>
                      <span class="identificador">{{ evento.ip || 'sin IP' }}</span
                      ><span class="secundario">{{ evento.userAgent || 'Sin agente' }}</span>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="vacio">
            <strong>Sin eventos para este filtro</strong>
            Cambia la acción o el tipo de registro.
          </p>
        }
      }

      <!-- ══════════ Formatos ══════════ -->
      @if (pestana() === 'formularios') {
        @if (formato(); as forma) {
          <section class="formatos-cabecera">
            <div>
              <h2>Formatos documentales</h2>
              <p>Biblioteca central de plantillas y registros operativos.</p>
            </div>
            <span class="distintivo vigente">Formato vigente publicado</span>
          </section>

          <div class="formatos-indicadores" aria-label="Resumen de formatos">
            <article><span>Formatos activos</span><strong>1</strong></article>
            <article>
              <span>Versión publicada</span><strong>v{{ forma.versionNumber }}</strong>
            </article>
            <article>
              <span>Campos configurados</span><strong>{{ forma.schemaJson.fields.length }}</strong>
            </article>
            <article><span>Estado</span><strong>Vigente</strong></article>
          </div>

          <article class="formato-tarjeta">
            <div class="formato-tarjeta-cabecera">
              <span>{{ forma.code }}</span
              ><small>v{{ forma.versionNumber }}</small>
            </div>
            <h3>{{ forma.name }}</h3>
            <p>{{ forma.description || 'Formato operativo publicado.' }}</p>
            <div class="formato-meta">
              <span>{{ forma.schemaJson.fields.length }} campos</span><span class="distintivo vigente">Vigente</span>
            </div>
            <button class="boton secundario compacto" type="button" (click)="alternarDetalleFormato()">
              {{ detalleFormato() ? 'Ocultar campos' : 'Ver campos' }}
            </button>
          </article>

          @if (detalleFormato()) {
            <section class="formatos-campos">
              <div class="titulo-seccion"><h3>Campos del formato vigente</h3></div>
              <div class="tabla-scroll">
                <table class="datos">
                  <thead>
                    <tr>
                      <th>Campo</th>
                      <th>Tipo</th>
                      <th>Obligatorio</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (campo of forma.schemaJson.fields; track campo.id) {
                      <tr>
                        <td>
                          <strong>{{ campo.label }}</strong>
                          <span class="secundario identificador">{{ campo.id }}</span>
                        </td>
                        <td>{{ campo.type }}</td>
                        <td>{{ campo.required ? 'Sí' : 'No' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </section>
          }
          <p class="formatos-nota">
            La publicación de nuevas versiones se administra actualmente desde la API; los permisos firmados conservan
            su versión original.
          </p>
        } @else {
          <p class="secundario">Cargando el formato vigente…</p>
        }
      }
    </main>
  `,
  styles: [
    `
      .app-cabecera a.marca {
        text-decoration: none;
      }
      .app-cabecera a.marca:hover {
        color: #fff;
      }

      /* ── Resumen ── */
      .admin-resumen-grid {
        display: grid;
        grid-template-columns: minmax(240px, 0.42fr) minmax(0, 1fr);
        gap: 18px;
      }
      .admin-resumen-grid .bloque + .bloque {
        margin-top: 0;
      }
      .admin-resumen-grid h2 {
        margin: 0 0 14px;
        font-size: 1.0625rem;
      }
      .admin-accesos-rapidos {
        display: grid;
        align-content: start;
        gap: 8px;
      }
      .admin-accesos-rapidos h2 {
        margin-bottom: 6px;
      }
      .admin-accesos-rapidos button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 48px;
        padding: 10px 14px;
        border: 1px solid var(--borde);
        border-radius: 12px;
        background: #f7f9fb;
        color: var(--tinta);
        font: inherit;
        font-family: var(--letra-marca);
        font-size: 0.875rem;
        font-weight: 700;
        text-align: left;
        cursor: pointer;
        transition:
          background-color 160ms ease,
          border-color 160ms ease;
      }
      .admin-accesos-rapidos button:hover {
        border-color: var(--azul);
        background: var(--teal-tenue);
        color: var(--azul-oscuro);
      }
      .admin-accesos-rapidos svg,
      .usuarios-cabecera svg {
        width: 18px;
        height: 18px;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        transition: transform 200ms var(--curva);
      }
      .admin-accesos-rapidos button:hover svg {
        transform: translateX(3px);
      }
      .admin-estado .titulo-seccion {
        margin-bottom: 6px;
      }
      .admin-estado .titulo-seccion h2 {
        margin: 0;
      }
      .admin-estado ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .admin-estado li {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 0;
        border-top: 1px solid #e6ebf0;
        color: var(--tinta);
        font-size: 0.9375rem;
      }
      .admin-estado li:first-child {
        border-top: 0;
      }
      .admin-estado li::before {
        content: '';
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--teal);
        box-shadow: 0 0 0 4px var(--teal-tenue);
      }
      .admin-estado li span {
        margin-right: auto;
      }
      .admin-estado li small {
        color: var(--tinta-suave);
        font-size: 0.8125rem;
        white-space: nowrap;
      }

      .admin-actividad {
        margin-top: 18px;
      }
      .admin-actividad ol {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .admin-actividad li {
        display: grid;
        grid-template-columns: minmax(0, 15rem) minmax(0, 1fr) auto;
        align-items: center;
        gap: 16px;
        padding: 12px 0;
        border-top: 1px solid #e6ebf0;
        font-size: 0.9375rem;
      }
      .admin-actividad li:first-child {
        border-top: 0;
      }
      .admin-actividad .evento-etiqueta {
        justify-self: start;
      }
      .admin-actividad .momento {
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }
      @media (max-width: 640px) {
        .admin-actividad li {
          grid-template-columns: 1fr;
          gap: 4px;
        }
      }

      /* ── Cabeceras de sección ── */
      .usuarios-cabecera,
      .auditoria-cabecera,
      .formatos-cabecera {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
      .usuarios-cabecera h2,
      .auditoria-cabecera h2,
      .formatos-cabecera h2 {
        margin: 0 0 4px;
        font-size: 1.375rem;
      }
      .usuarios-cabecera p,
      .auditoria-cabecera p,
      .formatos-cabecera p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.9375rem;
      }

      /* ── Cuentas ── */
      .crear-usuario,
      .editar-usuario {
        margin-bottom: 22px;
      }
      .editar-usuario {
        border-color: #b8d9d1;
        box-shadow:
          0 0 0 4px var(--teal-tenue),
          var(--sombra);
      }
      .crear-usuario h3,
      .editar-usuario h3 {
        margin: 0;
        font-size: 1.125rem;
      }
      .casilla span {
        display: block;
      }
      .usuarios-tabla {
        padding: 18px;
        border: 1px solid var(--borde);
        border-radius: var(--radio-grande);
        background: var(--superficie);
        box-shadow: var(--sombra);
      }
      .usuarios-tabla .tabla-scroll {
        box-shadow: none;
      }
      .usuarios-herramientas {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .usuarios-herramientas > span {
        color: var(--tinta-suave);
        font-size: 0.875rem;
        font-variant-numeric: tabular-nums;
      }
      .buscador-usuarios {
        width: min(100%, 340px);
      }
      .buscador-usuarios input {
        min-height: 42px;
        padding-left: 40px;
        background: #f7f9fb
          url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2355687c' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E")
          no-repeat 13px center / 17px;
        font-size: 0.9375rem;
      }
      .usuarios-datos td:first-child {
        min-width: 240px;
      }
      .usuarios-datos td:first-child strong {
        display: block;
      }
      .usuarios-datos td:first-child .secundario {
        margin-left: 44px;
      }
      .usuarios-datos td:last-child {
        white-space: nowrap;
      }
      .avatar-usuario {
        float: left;
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        margin-right: 10px;
        border-radius: 50%;
        background: linear-gradient(150deg, var(--marino-600), var(--marino));
        color: #fff;
        font-family: var(--letra-marca);
        font-size: 0.75rem;
        font-weight: 700;
        box-shadow: 0 3px 8px -3px rgb(8 33 58 / 0.5);
      }
      .editar-cuenta {
        min-height: 34px;
        padding: 5px 12px;
        border: 1px solid var(--borde-fuerte);
        border-radius: 9px;
        background: var(--superficie);
        color: var(--tinta);
        font: inherit;
        font-family: var(--letra-marca);
        font-size: 0.8125rem;
        font-weight: 700;
        cursor: pointer;
      }
      .editar-cuenta:hover {
        border-color: var(--azul);
        background: var(--teal-tenue);
        color: var(--azul-oscuro);
      }

      /* ── Auditoría ── */
      .auditoria-filtros {
        display: grid;
        gap: 12px;
        margin-bottom: 18px;
        padding: 14px;
        border: 1px solid var(--borde);
        border-radius: 14px;
        background: var(--superficie);
        box-shadow: var(--sombra-1);
      }
      .auditoria-filtros select {
        min-height: 44px;
      }
      @media (min-width: 640px) {
        .auditoria-filtros {
          grid-template-columns: repeat(2, minmax(0, 280px));
        }
      }
      .momento {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .identificador {
        font-size: 0.8125rem;
        word-break: break-all;
      }
      .evento-etiqueta {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 10px 3px 8px;
        border-radius: 999px;
        background: var(--teal-tenue);
        color: var(--azul-oscuro);
        font-size: 0.8125rem;
        font-weight: 650;
        white-space: nowrap;
      }
      .evento-etiqueta::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }
      .evento-alerta {
        background: #fbe1de;
        color: var(--error);
      }

      /* ── Formatos ── */
      .formatos-indicadores {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 28px;
      }
      .formatos-indicadores article {
        padding: 18px 20px;
        border: 1px solid var(--borde);
        border-radius: 16px;
        background: var(--superficie);
        box-shadow: var(--sombra);
      }
      .formatos-indicadores span {
        display: block;
        color: var(--tinta-media);
        font-size: 0.875rem;
        font-weight: 500;
      }
      .formatos-indicadores strong {
        display: block;
        margin-top: 6px;
        color: var(--marino);
        font-family: var(--letra-marca);
        font-size: 1.625rem;
        font-weight: 700;
        letter-spacing: -0.03em;
        font-variant-numeric: tabular-nums;
      }
      .formato-tarjeta {
        width: min(100%, 380px);
        padding: 22px;
        border: 1px solid var(--borde);
        border-radius: var(--radio-grande);
        background:
          url('/assets/marca/marca.png') no-repeat right 20px top 18px / 38px,
          var(--superficie);
        box-shadow: var(--sombra);
      }
      .formato-tarjeta-cabecera,
      .formato-meta {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .formato-tarjeta-cabecera span {
        padding: 4px 10px;
        border-radius: 8px;
        background: var(--marino);
        color: #fff;
        font-family: var(--letra-marca);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .formato-tarjeta-cabecera small {
        color: var(--tinta-suave);
        font-family: var(--letra-marca);
        font-size: 0.8125rem;
        font-weight: 700;
      }
      .formato-tarjeta h3 {
        margin: 18px 0 8px;
        font-size: 1.125rem;
      }
      .formato-tarjeta p {
        margin: 0 0 18px;
        color: var(--tinta-media);
        font-size: 0.9375rem;
        line-height: 1.5;
      }
      .formato-meta {
        justify-content: space-between;
        padding-top: 14px;
        border-top: 1px solid #e6ebf0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .formato-tarjeta .boton {
        width: 100%;
        margin-top: 18px;
      }
      .formatos-campos {
        margin-top: 26px;
      }
      .formatos-campos h3 {
        margin: 0;
        font-size: 1.125rem;
      }
      .formatos-nota {
        max-width: 80ch;
        margin: 20px 0 0;
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }

      @media (max-width: 900px) {
        .admin-resumen-grid {
          grid-template-columns: 1fr;
        }
        .formatos-indicadores {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 640px) {
        .usuarios-cabecera .boton {
          width: 100%;
        }
        .usuarios-tabla {
          padding: 14px;
        }
        .usuarios-herramientas {
          align-items: stretch;
          flex-direction: column;
        }
        .buscador-usuarios {
          width: 100%;
        }
        .formatos-indicadores {
          gap: 10px;
        }
        .formatos-indicadores article {
          padding: 14px;
        }
        .formato-tarjeta {
          width: 100%;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminDashboardComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);

  readonly pestana = signal<Pestana>('inicio');
  readonly roles = signal<Rol[]>([]);
  readonly usuarios = signal<Usuario[]>([]);
  readonly colaboradores = signal<Colaborador[]>([]);
  readonly cargos = signal<Cargo[]>([]);
  readonly seleccionados = signal<string[]>([]);
  readonly busqueda = signal('');
  readonly mostrarCrear = signal(false);
  readonly detalleFormato = signal(false);
  readonly cuentaEditando = signal<Cuenta | null>(null);
  readonly eventos = signal<Evento[]>([]);
  readonly formato = signal<Formulario | null>(null);
  readonly filtroAccion = signal('');
  readonly filtroEntidad = signal('');
  readonly guardando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');

  readonly formulario = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
  });
  readonly formularioEdicion = this.fb.nonNullable.group({
    email: ['', [Validators.email]],
    status: ['ACTIVE'],
    password: [''],
    firstName: [''],
    lastName: [''],
    phone: [''],
    jobPositionId: [''],
    team: [''],
  });

  readonly visibles = computed(() => {
    const accion = this.filtroAccion();
    const entidad = this.filtroEntidad();
    return this.eventos().filter(
      (evento) => (!accion || evento.action === accion) && (!entidad || evento.entityType === entidad),
    );
  });

  readonly accionesPresentes = computed(() => [...new Set(this.eventos().map((evento) => evento.action))].sort());
  readonly entidadesPresentes = computed(() => [...new Set(this.eventos().map((evento) => evento.entityType))].sort());
  readonly cuentasVisibles = computed(() => {
    const termino = this.busqueda().trim().toLowerCase();
    const internas = this.usuarios().map((usuario): Cuenta => ({
      id: usuario.id,
      tipo: 'INTERNO',
      nombre: usuario.email,
      email: 'Cuenta interna',
      detalle: this.nombresRoles(usuario),
      status: usuario.status,
      ultimoAcceso: usuario.lastAccessAt,
      usuario,
    }));
    const colaboradores = this.colaboradores().map((colaborador): Cuenta => ({
      id: colaborador.id,
      tipo: 'COLABORADOR',
      nombre: `${colaborador.firstName} ${colaborador.lastName}`,
      email: colaborador.email || `Documento ${colaborador.documentNumber}`,
      detalle: colaborador.jobTitle || colaborador.team || 'Colaborador',
      status: colaborador.status,
      ultimoAcceso: null,
      colaborador,
    }));
    return [...internas, ...colaboradores].filter(
      (cuenta) => !termino || `${cuenta.nombre} ${cuenta.email} ${cuenta.detalle}`.toLowerCase().includes(termino),
    );
  });

  constructor() {
    this.cargarRoles();
    this.cargarUsuarios();
    this.cargarColaboradores();
    this.cargarCargos();
    this.cargarAuditoria();
    this.cargarFormato();
  }

  ver(pestana: Pestana): void {
    this.pestana.set(pestana);
    if (pestana === 'auditoria' && !this.eventos().length) this.cargarAuditoria();
    if (pestana === 'formularios' && !this.formato()) this.cargarFormato();
  }

  // ── Cuentas ──────────────────────────────────────────────
  permisos(rol: Rol): string[] {
    return rol.permissions.map(({ permission }) => permission.code);
  }

  nombresRoles(usuario: Usuario): string {
    return usuario.roles.map((rol) => rol.name).join(', ') || 'Sin rol asignado';
  }

  iniciales(email: string): string {
    return email.slice(0, 2).toUpperCase();
  }

  editarCuenta(cuenta: Cuenta): void {
    this.error.set('');
    this.aviso.set('');
    this.cuentaEditando.set(cuenta);
    this.seleccionados.set(cuenta.usuario?.roles.map((rol) => rol.code) ?? []);
    this.formularioEdicion.reset({
      email: cuenta.tipo === 'INTERNO' ? cuenta.usuario!.email : cuenta.colaborador!.email || '',
      status: cuenta.status,
      password: '',
      firstName: cuenta.colaborador?.firstName || '',
      lastName: cuenta.colaborador?.lastName || '',
      phone: cuenta.colaborador?.phone || '',
      jobPositionId: cuenta.colaborador?.jobPositionId || '',
      team: cuenta.colaborador?.team || '',
    });
  }

  guardarEdicion(): void {
    const cuenta = this.cuentaEditando();
    if (!cuenta || this.formularioEdicion.invalid) return;
    const value = this.formularioEdicion.getRawValue();
    const payload =
      cuenta.tipo === 'INTERNO'
        ? {
            email: value.email,
            status: value.status,
            roleCodes: this.seleccionados(),
            ...(value.password ? { password: value.password } : {}),
          }
        : {
            email: value.email,
            status: value.status,
            firstName: value.firstName,
            lastName: value.lastName,
            phone: value.phone,
            jobPositionId: value.jobPositionId || null,
            team: value.team,
          };
    this.guardando.set(true);
    this.http
      .patch(cuenta.tipo === 'INTERNO' ? `/api/users/${cuenta.id}` : `/api/collaborators/${cuenta.id}`, payload)
      .subscribe({
        next: () => {
          this.aviso.set('Los cambios se guardaron correctamente.');
          this.cuentaEditando.set(null);
          this.cargarUsuarios();
          this.cargarColaboradores();
          this.guardando.set(false);
        },
        error: () => {
          this.error.set('No fue posible guardar los cambios. Revisa los datos e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }

  tieneRol(code: string): boolean {
    return this.seleccionados().includes(code);
  }

  alternarRol(code: string): void {
    this.seleccionados.update((lista) =>
      lista.includes(code) ? lista.filter((otro) => otro !== code) : [...lista, code],
    );
  }

  alternarFormularioUsuario(): void {
    this.mostrarCrear.update((valor) => !valor);
  }

  alternarDetalleFormato(): void {
    this.detalleFormato.update((valor) => !valor);
  }

  crearUsuario(): void {
    if (this.formulario.invalid || !this.seleccionados().length) return;
    this.guardando.set(true);
    this.error.set('');
    this.aviso.set('');
    this.http
      .post<{ email: string }>('/api/users', { ...this.formulario.getRawValue(), roleCodes: this.seleccionados() })
      .subscribe({
        next: (creado) => {
          this.aviso.set(`${creado.email} quedó creado. Deberá cambiar su contraseña al ingresar.`);
          this.formulario.reset({ email: '', password: '' });
          this.seleccionados.set([]);
          this.mostrarCrear.set(false);
          this.cargarUsuarios();
          this.guardando.set(false);
        },
        error: (respuesta: { status: number }) => {
          this.error.set(
            respuesta.status === 409
              ? 'Ya existe un usuario con ese correo.'
              : 'No fue posible crear el usuario. Revisa los datos e intenta de nuevo.',
          );
          this.guardando.set(false);
        },
      });
  }

  // ── Auditoría ────────────────────────────────────────────
  cargarAuditoria(): void {
    this.http.get<Evento[]>('/api/audit', { params: { take: 200 } }).subscribe({
      next: (eventos) => this.eventos.set(eventos),
      error: () => this.error.set('No fue posible consultar la auditoría o no tienes permiso.'),
    });
  }

  nombreAccion(accion: string): string {
    return ACCIONES[accion] ?? accion;
  }

  nombreEntidad(entidad: string): string {
    return ENTIDADES[entidad] ?? entidad;
  }

  nombreActor(evento: Evento): string {
    if (evento.actorUser?.email) return evento.actorUser.email;
    if (evento.actorCollaborator) return `${evento.actorCollaborator.firstName} ${evento.actorCollaborator.lastName}`;
    return 'Sistema';
  }

  /** Los intentos fallidos se destacan: son la señal que se busca al auditar. */
  esFallo(evento: Evento): boolean {
    return evento.action.endsWith('_FAILED') || evento.action === 'REJECT_SUBMISSION';
  }

  momento(valor: string): string {
    return fechaHora(valor);
  }

  private cargarRoles(): void {
    this.http.get<Rol[]>('/api/users/roles').subscribe({
      next: (roles) => this.roles.set(roles),
      error: () => this.error.set('No fue posible cargar los roles. Verifica tu sesión.'),
    });
  }

  private cargarUsuarios(): void {
    this.http.get<Usuario[]>('/api/users').subscribe({
      next: (usuarios) => this.usuarios.set(usuarios),
      error: () => this.error.set('No fue posible cargar los usuarios o no tienes permiso.'),
    });
  }

  private cargarColaboradores(): void {
    this.http.get<Colaborador[]>('/api/collaborators').subscribe({
      next: (colaboradores) => this.colaboradores.set(colaboradores),
      error: () => this.error.set('No fue posible cargar los colaboradores o no tienes permiso.'),
    });
  }

  private cargarCargos(): void {
    this.http.get<Cargo[]>('/api/collaborators/job-positions').subscribe({
      next: (cargos) => this.cargos.set(cargos),
      error: () => this.error.set('No fue posible cargar el catálogo de cargos.'),
    });
  }

  private cargarFormato(): void {
    this.http.get<Formulario>('/api/forms/HSE-FO-016/current').subscribe({
      next: (formato) => this.formato.set(formato),
      error: () => this.error.set('No fue posible cargar el formato vigente.'),
    });
  }
}
