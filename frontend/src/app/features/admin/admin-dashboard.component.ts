import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { fechaHora } from '../../core/fechas';

type Rol = { code: string; name: string; permissions: { permission: { code: string } }[] };

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
    <header class="admin-bar">
      <div class="admin-bar-inner">
        <a
          class="admin-wordmark"
          routerLink="/administracion/panel"
          (click)="ver('inicio')"
          aria-label="Ir al inicio de Administración"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 18 5.4v5.4c0 4.1-2.5 7.8-6 9.2-3.5-1.4-6-5.1-6-9.2V5.4L12 3Z" />
            <path d="m9.2 11.6 1.8 1.8 3.9-4" />
          </svg>
          <span>Administración</span>
        </a>
        <sg-logout-button />
      </div>
    </header>

    <main class="app-contenido">
      @if (pestana() !== 'inicio') {
        <section class="admin-masthead" aria-labelledby="admin-titulo">
          <div class="admin-resumen">
            <div>
              <h1 id="admin-titulo">Administración del sistema</h1>
              <p>Gestiona cuentas internas, consulta la trazabilidad y revisa los formatos publicados.</p>
            </div>
            <span class="admin-contexto">Acceso restringido</span>
          </div>

          <div class="pestanas admin-tabs" role="tablist" aria-label="Secciones de Administración">
            <button role="tab" type="button" [attr.aria-selected]="pestana() === 'accesos'" (click)="ver('accesos')">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M16 19v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V19" />
                <circle cx="9.5" cy="7" r="3.2" />
                <path d="M17 8h4m-2-2v4" />
              </svg>
              Cuentas y permisos
            </button>
            <button
              role="tab"
              type="button"
              [attr.aria-selected]="pestana() === 'auditoria'"
              (click)="ver('auditoria')"
            >
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
      }

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      @if (aviso()) {
        <p class="mensaje ok" role="status">{{ aviso() }}</p>
      }

      @if (pestana() === 'inicio') {
        <section class="admin-inicio" aria-labelledby="inicio-titulo">
          <aside class="admin-rail" aria-label="Secciones de Administración">
            <div class="admin-rail-titulo">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3 18 5.4v5.4c0 4.1-2.5 7.8-6 9.2-3.5-1.4-6-5.1-6-9.2V5.4L12 3Z" />
                <path d="m9.2 11.6 1.8 1.8 3.9-4" />
              </svg>
              <div>
                <strong>Administración<br />del sistema</strong><span>Gestiona cuentas internas y trazabilidad</span>
              </div>
            </div>
            <div class="admin-rail-nav">
              <button type="button" (click)="ver('accesos')">Cuentas y permisos</button>
              <button type="button" (click)="ver('auditoria')">Auditoría</button>
              <button type="button" (click)="ver('formularios')">Formatos</button>
            </div>
          </aside>

          <div class="admin-panel-principal">
            <header class="admin-saludo">
              <h1 id="inicio-titulo">Hola, Administrador</h1>
              <p>Aquí tienes el resumen operativo del sistema SG-SST.</p>
            </header>

            <div class="admin-indicadores" aria-label="Resumen administrativo">
              <article>
                <span>Roles disponibles</span>
                <strong>{{ roles().length }}</strong>
                <small>Para asignar a usuarios internos</small>
              </article>
              <article>
                <span>Eventos cargados</span>
                <strong>{{ eventos().length }}</strong>
                <small>Registros de auditoría recientes</small>
              </article>
              <article>
                <span>Formato vigente</span>
                <strong>{{ formato() ? 'v' + formato()!.versionNumber : '—' }}</strong>
                <small>{{ formato()?.code || 'Cargando formato' }}</small>
              </article>
            </div>

            <div class="admin-resumen-grid">
              <section class="admin-accesos-rapidos" aria-labelledby="accesos-rapidos-titulo">
                <h2 id="accesos-rapidos-titulo">Accesos rápidos</h2>
                <button type="button" (click)="ver('accesos')">Crear usuario <span aria-hidden="true">›</span></button>
                <button type="button" (click)="ver('formularios')">
                  Revisar formato <span aria-hidden="true">›</span>
                </button>
                <button type="button" (click)="ver('auditoria')">
                  Consultar auditoría <span aria-hidden="true">›</span>
                </button>
              </section>
              <section class="admin-estado" aria-labelledby="estado-titulo">
                <div class="admin-estado-cabecera">
                  <h2 id="estado-titulo">Estado del sistema</h2>
                  <span>Disponible</span>
                </div>
                <ul>
                  <li><span>Acceso administrativo protegido</span><small>Activo</small></li>
                  <li>
                    <span>Roles y permisos cargados</span
                    ><small>{{ roles().length ? 'Actualizado' : 'Cargando' }}</small>
                  </li>
                  <li>
                    <span>Registro de trazabilidad</span
                    ><small>{{ eventos().length ? 'Disponible' : 'Sin datos' }}</small>
                  </li>
                </ul>
              </section>
            </div>
          </div>
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
              {{ mostrarCrear() ? 'Cerrar formulario' : '+ Crear usuario' }}
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
                  <label class="campo"><span>Cargo</span><input formControlName="jobTitle" /></label>
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

        <div class="filtros auditoria-filtros">
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
      .acciones {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      .admin-resumen {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 24px;
        margin: 6px 0 30px;
      }
      .admin-resumen h1 {
        margin: 0 0 8px;
        font-size: clamp(1.8rem, 3vw, 2.55rem);
        letter-spacing: -0.035em;
      }
      .admin-resumen p {
        max-width: 62ch;
        margin: 0;
        color: var(--tinta-media);
      }
      .admin-contexto {
        flex: none;
        padding: 7px 11px;
        border: 1px solid #b9d5c7;
        border-radius: 999px;
        background: #edf8f2;
        color: #155d4a;
        font-size: 0.8125rem;
        font-weight: 700;
      }
      .admin-tabs {
        margin-bottom: 28px;
        padding: 5px;
        border: 1px solid var(--borde);
        border-radius: 16px;
        background: rgb(255 255 255 / 0.72);
      }
      .admin-tabs button {
        flex: 1 1 auto;
        justify-content: center;
      }
      .admin-cuentas {
        width: 100%;
      }
      .usuarios-cabecera {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 20px;
      }
      .usuarios-cabecera h2 {
        margin: 0 0 4px;
        font-size: 1.45rem;
        letter-spacing: -0.03em;
      }
      .usuarios-cabecera p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .crear-usuario {
        margin-bottom: 20px;
      }
      .editar-usuario {
        margin-bottom: 20px;
        background: #f7fbf8;
      }
      .crear-usuario h3 {
        margin: 0;
        font-size: 1.08rem;
      }
      .usuarios-tabla {
        padding: 20px;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 26px rgb(24 50 68 / 0.06);
      }
      .usuarios-herramientas {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: center;
        margin-bottom: 18px;
      }
      .usuarios-herramientas > span {
        color: var(--tinta-suave);
        font-size: 0.8125rem;
      }
      .buscador-usuarios {
        width: min(100%, 310px);
      }
      .buscador-usuarios input {
        min-height: 40px;
        font-size: 0.8125rem;
      }
      .usuarios-datos td:first-child {
        min-width: 210px;
      }
      .usuarios-datos td:last-child {
        white-space: nowrap;
      }
      .avatar-usuario {
        display: inline-grid;
        place-items: center;
        width: 25px;
        height: 25px;
        margin-right: 9px;
        border-radius: 50%;
        background: #b5ddd0;
        color: #175745;
        font-size: 0.6875rem;
        font-weight: 800;
        vertical-align: middle;
      }
      .usuarios-datos strong {
        font-size: 0.8125rem;
        font-weight: 700;
      }
      .usuarios-datos td {
        color: #3c5661;
        font-size: 0.8125rem;
      }
      .editar-cuenta {
        border: 0;
        background: transparent;
        color: var(--azul-oscuro);
        font: inherit;
        font-size: 0.75rem;
        font-weight: 750;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
      .crear-usuario {
        min-height: 100%;
      }
      .secundario {
        display: block;
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }
      .introduccion {
        margin: -6px 0 20px;
      }
      h3 {
        margin: 26px 0 10px;
        font-size: 1.0625rem;
      }

      .filtros {
        display: grid;
        gap: 14px;
        margin-bottom: 18px;
      }
      .auditoria-cabecera {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 20px;
      }
      .auditoria-cabecera h2 {
        margin: 0 0 4px;
        font-size: 1.45rem;
        letter-spacing: -0.03em;
      }
      .auditoria-cabecera p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .auditoria-filtros {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin: -56px 0 20px;
      }
      .auditoria-filtros .campo {
        width: auto;
      }
      .auditoria-filtros select {
        min-height: 40px;
        min-width: 175px;
        font-size: 0.8125rem;
      }
      .evento-etiqueta {
        display: inline-block;
        padding: 4px 9px;
        border-radius: 999px;
        background: #e1f1ea;
        color: #1b6250;
        font-size: 0.6875rem;
        font-weight: 750;
        white-space: nowrap;
      }
      .evento-alerta {
        background: #fbe5e2;
        color: #9c251e;
      }
      .formatos-cabecera {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 20px;
      }
      .formatos-cabecera h2 {
        margin: 0 0 4px;
        font-size: 1.45rem;
        letter-spacing: -0.03em;
      }
      .formatos-cabecera p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .formatos-indicadores {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-bottom: 30px;
      }
      .formatos-indicadores article {
        padding: 17px 18px;
        border: 1px solid #e1e6e1;
        border-radius: 12px;
        background: #fff;
      }
      .formatos-indicadores span {
        display: block;
        color: var(--tinta-media);
        font-size: 0.6875rem;
        font-weight: 750;
        letter-spacing: 0.035em;
        text-transform: uppercase;
      }
      .formatos-indicadores strong {
        display: block;
        margin-top: 6px;
        font-size: 1.35rem;
        letter-spacing: -0.03em;
      }
      .formato-tarjeta {
        width: min(100%, 340px);
        padding: 20px;
        border: 1px solid #e1e6e1;
        border-radius: 14px;
        background: #fff;
        box-shadow: 0 10px 26px rgb(24 50 68 / 0.06);
      }
      .formato-tarjeta-cabecera,
      .formato-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .formato-tarjeta-cabecera span {
        padding: 4px 8px;
        border-radius: 999px;
        background: #dcefe7;
        color: #175746;
        font-size: 0.6875rem;
        font-weight: 750;
      }
      .formato-tarjeta-cabecera small {
        color: var(--tinta-suave);
        font-size: 0.75rem;
        font-weight: 700;
      }
      .formato-tarjeta h3 {
        margin: 17px 0 8px;
        font-size: 1.05rem;
      }
      .formato-tarjeta p {
        min-height: 48px;
        margin: 0 0 18px;
        color: var(--tinta-media);
        font-size: 0.8125rem;
        line-height: 1.45;
      }
      .formato-meta {
        padding-top: 14px;
        border-top: 1px solid #edf0ed;
        color: var(--tinta-media);
        font-size: 0.75rem;
      }
      .formato-tarjeta .boton {
        width: 100%;
        margin-top: 18px;
      }
      .formatos-campos {
        margin-top: 24px;
      }
      .formatos-nota {
        max-width: 80ch;
        margin: 18px 0 0;
        color: var(--tinta-suave);
        font-size: 0.8125rem;
      }
      .tabla-scroll {
        background: var(--superficie);
      }
      .tabla-scroll table.datos tbody tr {
        transition: background-color 150ms ease;
      }
      @media (min-width: 640px) {
        .filtros {
          grid-template-columns: 1fr 1fr;
          max-width: 620px;
        }
      }

      .momento {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .identificador {
        font-size: 0.75rem;
        word-break: break-all;
      }
      .fila-alerta {
        background: var(--error-fondo);
      }
      .casilla span {
        display: block;
      }
      @media (max-width: 640px) {
        .admin-resumen {
          align-items: start;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 22px;
        }
        .admin-tabs {
          margin-inline: -2px;
        }
        .admin-tabs button {
          flex: 0 0 auto;
        }
      }

      /* La consola se apoya en una cabecera sobria y una franja de contexto,
         para que los cambios de sección no oculten dónde se está trabajando. */
      .admin-bar {
        border-bottom: 1px solid #dde3df;
        background: #fffefb;
      }
      .admin-bar-inner {
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 24px;
        max-width: 1240px;
        min-height: 68px;
        margin-inline: auto;
        padding: 0 28px;
      }
      .admin-wordmark {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        width: fit-content;
        color: var(--tinta);
        font-size: 0.9375rem;
        font-weight: 750;
        text-decoration: none;
      }
      .admin-wordmark svg {
        width: 19px;
        height: 19px;
        fill: #dff1e8;
        stroke: var(--azul-oscuro);
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.7px;
      }
      .admin-bar sg-logout-button {
        justify-self: end;
      }

      .app-contenido {
        max-width: 1240px;
        padding-top: 30px;
      }
      .admin-masthead {
        margin-bottom: 30px;
        padding: 21px 24px 14px;
        border-radius: 16px;
        background: #efeee8;
      }
      .admin-resumen {
        align-items: center;
        margin: 0 0 18px;
      }
      .admin-resumen h1 {
        margin-bottom: 3px;
        font-size: clamp(1.45rem, 2.6vw, 2rem);
        letter-spacing: -0.03em;
      }
      .admin-resumen p {
        font-size: 0.875rem;
      }
      .admin-contexto {
        border: 0;
        background: #dceee5;
        color: #245d4c;
        font-size: 0.75rem;
      }
      .admin-tabs {
        justify-content: flex-end;
        gap: 6px;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
      }
      .admin-tabs button {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 7px;
        padding: 9px 14px;
        color: #294654;
        font-size: 0.8125rem;
        font-weight: 650;
      }
      .admin-tabs button svg {
        width: 15px;
        height: 15px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.8px;
      }
      .admin-tabs button:hover {
        background: rgb(255 255 255 / 66%);
      }
      .admin-tabs button[aria-selected='true'] {
        background: #98cbbb;
        color: #123f38;
      }
      .admin-tabs .globo {
        margin-left: 1px;
        padding: 0 5px;
        background: rgb(255 255 255 / 55%);
        color: inherit;
        font-size: 0.6875rem;
      }
      .bloque {
        padding: 26px;
        border: 1px solid #e2e5e1;
        box-shadow: 0 10px 26px rgb(24 50 68 / 0.06);
      }
      .titulo-seccion h2 {
        font-size: 1.35rem;
        letter-spacing: -0.025em;
      }
      .introduccion {
        max-width: 67ch;
        line-height: 1.6;
      }
      .filtros {
        padding: 16px;
        border-radius: 12px;
        background: #f6f7f3;
      }
      .tabla-scroll {
        border-color: #e3e6e2;
        border-radius: 12px;
        box-shadow: none;
      }
      table.datos th,
      table.datos td {
        padding: 14px 16px;
      }
      table.datos thead th {
        background: #f1f2ed;
      }
      table.datos tbody tr:hover {
        background: #f2f8f4;
      }

      .admin-inicio {
        display: grid;
        grid-template-columns: 176px minmax(0, 1fr);
        gap: 26px;
        align-items: start;
        padding-top: 18px;
      }
      .admin-rail {
        padding: 20px 16px;
        border-radius: 14px;
        background: #efeee8;
      }
      .admin-rail-titulo {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }
      .admin-rail-titulo svg {
        flex: none;
        width: 25px;
        height: 25px;
        margin-top: 2px;
        fill: #a8d4c4;
        stroke: #1d6352;
        stroke-linecap: round;
        stroke-linejoin: round;
        stroke-width: 1.7px;
      }
      .admin-rail-titulo strong {
        display: block;
        font-size: 0.875rem;
        line-height: 1.22;
      }
      .admin-rail-titulo span {
        display: block;
        margin-top: 5px;
        color: var(--tinta-media);
        font-size: 0.6875rem;
        line-height: 1.35;
      }
      .admin-rail-nav {
        display: grid;
        gap: 4px;
        margin-top: 22px;
      }
      .admin-rail-nav button,
      .admin-accesos-rapidos button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        border: 0;
        color: #234451;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .admin-rail-nav button {
        padding: 10px 10px;
        border-radius: 9px;
        background: transparent;
        font-size: 0.75rem;
        font-weight: 650;
      }
      .admin-rail-nav button:hover,
      .admin-rail-nav button:focus-visible {
        background: #fffefa;
      }
      .admin-panel-principal {
        min-width: 0;
      }
      .admin-saludo {
        margin: 0 0 30px;
      }
      .admin-saludo h1 {
        margin: 0 0 4px;
        font-size: clamp(1.75rem, 3vw, 2.2rem);
        letter-spacing: -0.035em;
      }
      .admin-saludo p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .admin-indicadores {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin-bottom: 30px;
      }
      .admin-indicadores article {
        min-height: 128px;
        padding: 20px;
        border: 1px solid #dce3df;
        border-radius: 12px;
        background: #fff;
      }
      .admin-indicadores span,
      .admin-indicadores small {
        display: block;
        color: var(--tinta-media);
        font-size: 0.6875rem;
      }
      .admin-indicadores span {
        font-weight: 750;
        letter-spacing: 0.035em;
        text-transform: uppercase;
      }
      .admin-indicadores strong {
        display: block;
        margin: 13px 0 7px;
        color: #142d3c;
        font-size: 1.75rem;
        letter-spacing: -0.04em;
        line-height: 1;
        font-variant-numeric: tabular-nums;
      }
      .admin-resumen-grid {
        display: grid;
        grid-template-columns: minmax(230px, 0.45fr) minmax(0, 1fr);
        gap: 16px;
      }
      .admin-accesos-rapidos,
      .admin-estado {
        padding: 20px;
        border: 1px solid #dce3df;
        border-radius: 12px;
        background: #fff;
      }
      .admin-accesos-rapidos h2,
      .admin-estado h2 {
        margin: 0 0 16px;
        font-size: 1rem;
        letter-spacing: -0.015em;
      }
      .admin-accesos-rapidos {
        display: grid;
        gap: 8px;
      }
      .admin-accesos-rapidos h2 {
        margin-bottom: 4px;
      }
      .admin-accesos-rapidos button {
        min-height: 42px;
        padding: 10px 12px;
        border-radius: 8px;
        background: #f1f1ec;
        font-size: 0.75rem;
        font-weight: 700;
      }
      .admin-accesos-rapidos button:hover {
        background: #e0eee7;
        color: #124b3e;
      }
      .admin-accesos-rapidos button span {
        font-size: 1.4rem;
        font-weight: 400;
        line-height: 0.75;
      }
      .admin-estado-cabecera {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: start;
      }
      .admin-estado-cabecera span {
        padding: 4px 9px;
        border-radius: 999px;
        background: #a8d4c4;
        color: #164e40;
        font-size: 0.6875rem;
        font-weight: 750;
      }
      .admin-estado ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .admin-estado li {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        padding: 12px 0;
        border-top: 1px solid #edf0ed;
        color: #294754;
        font-size: 0.75rem;
      }
      .admin-estado li::before {
        width: 6px;
        height: 6px;
        margin: 6px 0 0;
        border-radius: 50%;
        background: #28785f;
        content: '';
      }
      .admin-estado li span {
        margin-right: auto;
      }
      .admin-estado li small {
        color: var(--tinta-media);
        white-space: nowrap;
      }

      @media (max-width: 640px) {
        .admin-bar-inner {
          min-height: 60px;
          padding: 0 16px;
        }
        .admin-masthead {
          margin-inline: -2px;
          padding: 18px 16px 12px;
        }
        .admin-resumen {
          align-items: start;
        }
        .admin-contexto {
          display: none;
        }
        .admin-tabs {
          justify-content: flex-start;
          overflow-x: auto;
        }
        .admin-tabs button {
          padding: 9px 12px;
        }
        .bloque {
          padding: 20px 16px;
        }
        .usuarios-cabecera {
          align-items: start;
          flex-direction: column;
        }
        .usuarios-cabecera .boton {
          width: 100%;
        }
        .usuarios-tabla {
          padding: 16px;
        }
        .usuarios-herramientas {
          align-items: stretch;
          flex-direction: column;
        }
        .buscador-usuarios {
          width: 100%;
        }
        .auditoria-cabecera {
          align-items: start;
          flex-direction: column;
        }
        .auditoria-filtros {
          display: grid;
          grid-template-columns: 1fr;
          margin: 0 0 18px;
        }
        .auditoria-filtros select {
          width: 100%;
        }
        .formatos-cabecera {
          align-items: start;
          flex-direction: column;
        }
        .formatos-indicadores {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .formatos-indicadores article {
          padding: 14px;
        }
        .formato-tarjeta {
          width: 100%;
        }
        .admin-inicio {
          grid-template-columns: 1fr;
          gap: 20px;
          padding-top: 0;
        }
        .admin-rail {
          padding: 16px;
        }
        .admin-rail-nav {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin-top: 16px;
        }
        .admin-rail-nav button {
          padding: 8px 5px;
          font-size: 0.6875rem;
          text-align: center;
          justify-content: center;
        }
        .admin-saludo {
          margin-bottom: 22px;
        }
        .admin-indicadores,
        .admin-resumen-grid {
          grid-template-columns: 1fr;
        }
        .admin-indicadores {
          gap: 10px;
          margin-bottom: 22px;
        }
        .admin-indicadores article {
          min-height: auto;
          padding: 16px;
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
    jobTitle: [''],
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
      jobTitle: cuenta.colaborador?.jobTitle || '',
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
            jobTitle: value.jobTitle,
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

  private cargarFormato(): void {
    this.http.get<Formulario>('/api/forms/HSE-FO-016/current').subscribe({
      next: (formato) => this.formato.set(formato),
      error: () => this.error.set('No fue posible cargar el formato vigente.'),
    });
  }
}
