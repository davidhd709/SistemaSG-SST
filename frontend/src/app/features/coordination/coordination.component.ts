import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthSessionService } from '../../core/auth-session.service';
import { fechaCalendario, fechaHora } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';

type Dashboard = {
  pending: number;
  inProgress: number;
  approved: number;
  closed: number;
  rejected: number;
  blockedByArl: number;
  overdue: number;
};

/** Jornada autorizada que sigue abierta. */
type JornadaAbierta = {
  id: string;
  workDate: string | null;
  startedAt: string | null;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  crewSize: number;
  members: { collaborator: { firstName: string; lastName: string }; jobPosition: { name: string } | null }[];
  form: { code: string; name: string };
  overdue: boolean;
};

type DocumentoCustodia = {
  id: string;
  status: string;
  workDate: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  members: {
    collaborator: { firstName: string; lastName: string; documentNumber: string };
    jobPosition: { name: string } | null;
  }[];
  form: { code: string; name: string; version: number };
  finalPdfFile: { id: string; originalName: string } | null;
};

type Cumplimiento = {
  arl: { estado: string };
  seguridadSocial: { estado: string; reference?: string };
  alturas: { estado: string; expiresAt?: string };
  apto: boolean;
  faltantes: string[];
};

type FilaCumplimiento = {
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string; jobTitle: string | null };
  cumplimiento: Cumplimiento;
};

type Planilla = {
  id: string;
  reference: string;
  providerName: string | null;
  periodStart: string;
  periodEnd: string;
  file: { id: string; originalName: string } | null;
  members: { id: string; firstName: string; lastName: string }[];
};

type Certificado = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  trainingEntity: string | null;
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string };
  file: { id: string; originalName: string } | null;
};

/** Integrante de la cuadrilla tal como lo ve Coordinación al revisar. */
type Integrante = {
  id: string;
  isLead: boolean;
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string };
  jobPosition: { code: string; name: string } | null;
  signature: { sha256: string; file: { id: string } } | null;
  members: Integrante[];
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  status?: string;
};

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
  members: Integrante[];
  status?: string;
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
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
 * responsabilidad: revisar y autorizar el inicio de labores.
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
          <p>Revisa y autoriza los permisos de trabajo pendientes.</p>
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
          <button role="tab" [attr.aria-selected]="pestana() === 'jornadas'" (click)="verJornadas()" type="button">
            Cuadrillas activas
          </button>
          <button
            role="tab"
            [attr.aria-selected]="pestana() === 'cumplimiento'"
            (click)="verCumplimiento()"
            type="button"
          >
            Curso de alturas
          </button>
          <button
            role="tab"
            [attr.aria-selected]="pestana() === 'colaboradores'"
            (click)="verColaboradores()"
            type="button"
          >
            Colaboradores
          </button>
          <button role="tab" [attr.aria-selected]="pestana() === 'custodia'" (click)="verCustodia()" type="button">
            Custodia documental
          </button>
        </div>
      </section>

      @if (dashboard()?.overdue) {
        <p class="mensaje alerta" role="status">
          Hay {{ dashboard()?.overdue }}
          {{ dashboard()?.overdue === 1 ? 'jornada de un día anterior' : 'jornadas de días anteriores' }} sin cerrar.
          <button class="boton secundario compacto" type="button" (click)="verJornadas()">Ver cuáles</button>
        </p>
      }

      <!-- ══════════════ BANDEJA ══════════════ -->
      @if (pestana() === 'bandeja') {
        @if (dashboard(); as m) {
          <section class="indicadores">
            <div class="indicador">
              <span class="cifra">{{ m.pending }}</span>
              <span class="rotulo">Esperando revisión</span>
            </div>
            <div class="indicador">
              <span class="cifra">{{ m.inProgress }}</span>
              <span class="rotulo">Jornadas en curso</span>
            </div>
            <div class="indicador" [class.atencion]="m.overdue > 0">
              <span class="cifra">{{ m.overdue }}</span>
              <span class="rotulo">Sin cerrar de días pasados</span>
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

            <h3>
              Cuadrilla y firmas <span class="conteo">({{ item.members.length }})</span>
            </h3>
            <p class="secundario">
              El permiso ampara a estas personas y a nadie más. Cada una firmó la suya al enviarlo.
            </p>
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Integrante</th>
                    <th>Cargo</th>
                    <th>Firma</th>
                  </tr>
                </thead>
                <tbody>
                  @for (integrante of item.members; track integrante.id) {
                    <tr>
                      <td>
                        <strong>
                          {{ integrante.collaborator.firstName }} {{ integrante.collaborator.lastName }}
                        </strong>
                        <span class="secundario">
                          {{ integrante.collaborator.documentNumber }}
                          @if (integrante.isLead) {
                            · responsable
                          }
                        </span>
                      </td>
                      <td>{{ integrante.jobPosition?.name || '—' }}</td>
                      <td>
                        @if (firmasCuadrilla()[integrante.id]; as url) {
                          <img class="firma" [src]="url" [alt]="'Firma de ' + integrante.collaborator.firstName" />
                        } @else {
                          <span class="secundario">Sin firma</span>
                        }
                        <span class="huella">{{ integrante.signature?.sha256 || 'Sin registro' }}</span>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>

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
      <!-- ══════════════ JORNADAS ABIERTAS ══════════════ -->
      @if (pestana() === 'jornadas') {
        <div class="titulo-seccion">
          <h2>
            Jornadas sin cerrar <span class="conteo">({{ jornadas().length }})</span>
          </h2>
          <button class="boton secundario compacto" type="button" (click)="cargarJornadas()">Actualizar</button>
        </div>
        <p class="secundario introduccion">
          Permisos autorizados cuya cuadrilla aún no registró su hora de finalización. Los de días anteriores necesitan
          seguimiento: sin cierre no se genera el documento final.
        </p>

        @if (jornadas().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Responsable</th>
                  <th>Cuadrilla</th>
                  <th>Día</th>
                  <th>Inició</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (jornada of jornadas(); track jornada.id) {
                  <tr [class.fila-alerta]="jornada.overdue">
                    <td>
                      <strong>{{ jornada.collaborator.firstName }} {{ jornada.collaborator.lastName }}</strong>
                      <span class="secundario">{{ jornada.collaborator.documentNumber }}</span>
                    </td>
                    <td>
                      {{ jornada.crewSize }} {{ jornada.crewSize === 1 ? 'persona' : 'personas' }}
                      <span class="secundario">{{ integrantesTexto(jornada.members) }}</span>
                    </td>
                    <td>
                      {{ soloFecha(jornada.workDate) }}
                      @if (jornada.overdue) {
                        <span class="secundario">día anterior</span>
                      }
                    </td>
                    <td>
                      {{ hora(jornada.startedAt) }}
                      <span class="secundario">{{ duracionDesde(jornada.startedAt) }}</span>
                    </td>
                    <td>
                      <button class="boton compacto" type="button" (click)="abrir(jornada.id)">Ver permiso</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="vacio">
            <strong>No hay jornadas abiertas</strong>
            Todas las cuadrillas cerraron su permiso.
          </p>
        }
      }

      <!-- ══════════════ CUSTODIA DOCUMENTAL ══════════════ -->
      @if (pestana() === 'custodia') {
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>Formularios diligenciados</h2>
            <button class="boton secundario compacto" type="button" (click)="cargarCustodia()">Actualizar</button>
          </div>
          <p class="secundario introduccion">
            Consulta y descarga los permisos para su custodia física y digital. Filtra por un mes completo o por una
            fecha específica.
          </p>
          <form [formGroup]="formCustodia" (ngSubmit)="cargarCustodia()" class="rejilla-campos dos">
            <label class="campo"><span>Mes</span><input type="month" formControlName="month" /></label>
            <label class="campo"><span>Fecha específica</span><input type="date" formControlName="date" /></label>
            <div class="acciones ancho-total">
              <button class="boton" type="submit">Consultar formularios</button>
              <button class="boton secundario" type="button" (click)="limpiarCustodia()">Limpiar filtros</button>
              <button
                class="boton secundario"
                type="button"
                [disabled]="!pdfsCustodia().length"
                (click)="descargarCustodia()"
              >
                Descargar PDFs disponibles ({{ pdfsCustodia().length }})
              </button>
            </div>
          </form>

          @if (documentosCustodia().length) {
            <div class="tabla-scroll custodia-tabla">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Responsable y cuadrilla</th>
                    <th>Jornada</th>
                    <th>Estado</th>
                    <th>Documento</th>
                  </tr>
                </thead>
                <tbody>
                  @for (documento of documentosCustodia(); track documento.id) {
                    <tr>
                      <td>{{ soloFecha(documento.workDate || documento.submittedAt) }}</td>
                      <td>
                        <strong>{{ documento.collaborator.firstName }} {{ documento.collaborator.lastName }}</strong>
                        <span class="secundario"
                          >{{ documento.collaborator.documentNumber }} · {{ integrantesTexto(documento.members) }}</span
                        >
                      </td>
                      <td>{{ intervaloJornada(documento.startedAt, documento.closedAt) }}</td>
                      <td>
                        <span class="distintivo" [class]="claseEstadoDocumento(documento.status)">{{
                          textoEstadoDocumento(documento.status)
                        }}</span>
                      </td>
                      <td>
                        @if (documento.finalPdfFile) {
                          <button
                            class="boton secundario compacto"
                            type="button"
                            (click)="descargar(documento.finalPdfFile.id, documento.finalPdfFile.originalName)"
                          >
                            Descargar PDF
                          </button>
                        } @else {
                          <span class="secundario">PDF pendiente de cierre</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="vacio">
              <strong>No hay formularios para este filtro</strong>Prueba con otro mes, fecha o sin filtros.
            </p>
          }
        </section>
      }

      <!-- ══════════════ REQUISITOS ══════════════ -->
      @if (pestana() === 'cumplimiento') {
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>Quién puede subir hoy</h2>
            <button class="boton secundario compacto" type="button" (click)="cargarCumplimiento()">Actualizar</button>
          </div>
          <p class="secundario introduccion">
            Registra aquí el curso de trabajo en alturas de los Oficiales eléctricos. Para auxiliares, ayudantes y
            supervisores este requisito no aplica.
          </p>

          @if (cumplimiento().length) {
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>ARL</th>
                    <th>Seguridad social</th>
                    <th>Alturas</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  @for (fila of cumplimiento(); track fila.collaborator.id) {
                    <tr [class.fila-alerta]="!fila.cumplimiento.apto">
                      <td>
                        <strong>{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}</strong>
                        <span class="secundario">{{ fila.collaborator.documentNumber }}</span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="claseRequisito(fila.cumplimiento.arl.estado)">
                          {{ textoRequisito(fila.cumplimiento.arl.estado) }}
                        </span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="claseRequisito(fila.cumplimiento.seguridadSocial.estado)">
                          {{ textoRequisito(fila.cumplimiento.seguridadSocial.estado) }}
                        </span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="claseRequisito(fila.cumplimiento.alturas.estado)">
                          {{ textoRequisito(fila.cumplimiento.alturas.estado) }}
                        </span>
                      </td>
                      <td>
                        @if (fila.cumplimiento.apto) {
                          <span class="distintivo vigente">Puede subir</span>
                        } @else {
                          <span class="secundario">Falta {{ fila.cumplimiento.faltantes.join(', ') }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        <!-- ── Planilla de seguridad social ── -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>Registrar planilla de seguridad social</h2>
          </div>
          <p class="secundario introduccion">
            Cubre a todos los colaboradores que elijas por el periodo indicado. Para renovar solo a algunos, registra
            otra planilla con ese grupo.
          </p>

          <form [formGroup]="formPlanilla" (ngSubmit)="crearPlanilla()" class="rejilla-campos dos">
            <label class="campo">
              <span>Referencia de la planilla</span>
              <input formControlName="reference" autocomplete="off" placeholder="Por ejemplo, PILA-2026-09" />
            </label>
            <label class="campo">
              <span>Operador</span>
              <input formControlName="providerName" autocomplete="off" placeholder="Opcional" />
            </label>
            <label class="campo">
              <span>Inicio del periodo</span>
              <input type="date" formControlName="periodStart" />
            </label>
            <label class="campo">
              <span>Fin del periodo</span>
              <input type="date" formControlName="periodEnd" />
            </label>

            <div class="campo ancho-total">
              <span id="cubiertos-etiqueta">Colaboradores cubiertos</span>
              <div class="casillas" role="group" aria-labelledby="cubiertos-etiqueta">
                @for (fila of cumplimiento(); track fila.collaborator.id) {
                  <label class="casilla">
                    <input
                      type="checkbox"
                      [checked]="estaCubierto(fila.collaborator.id)"
                      (change)="alternarCubierto(fila.collaborator.id)"
                    />
                    <span>{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}</span>
                  </label>
                }
              </div>
            </div>

            <div class="acciones ancho-total">
              <button class="boton" [disabled]="formPlanilla.invalid || !cubiertos().length || guardando()">
                {{ guardando() ? 'Registrando…' : 'Registrar planilla' }}
              </button>
            </div>
          </form>

          <h3>Planillas registradas</h3>
          @if (planillas().length) {
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
                        {{ soloFecha(planilla.periodStart) }}
                        <span class="secundario">hasta {{ soloFecha(planilla.periodEnd) }}</span>
                      </td>
                      <td>{{ planilla.members.length }}</td>
                      <td>
                        @if (planilla.file) {
                          <button
                            class="boton secundario compacto"
                            type="button"
                            (click)="descargar(planilla.file.id, planilla.file.originalName)"
                          >
                            Ver soporte
                          </button>
                        } @else {
                          <label class="subir">
                            <input
                              type="file"
                              accept="application/pdf,image/png,image/jpeg"
                              (change)="subirSoportePlanilla(planilla.id, $event)"
                            />
                          </label>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="secundario">Todavía no hay planillas registradas.</p>
          }
        </section>

        <!-- ── Certificados de alturas ── -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>Certificados de trabajo en alturas</h2>
          </div>

          <form [formGroup]="formCertificado" (ngSubmit)="crearCertificado()" class="rejilla-campos dos">
            <label class="campo ancho-total">
              <span>Colaborador</span>
              <select formControlName="collaboratorId">
                <option value="">Selecciona un Oficial eléctrico</option>
                @for (fila of oficialesElectricos(); track fila.collaborator.id) {
                  <option [value]="fila.collaborator.id">
                    {{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}
                  </option>
                }
              </select>
              <span class="ayuda">Solo los Oficiales eléctricos requieren certificado de trabajo en alturas.</span>
            </label>
            <label class="campo">
              <span>Fecha de expedición</span>
              <input type="date" formControlName="issuedAt" />
            </label>
            <label class="campo">
              <span>Vence</span>
              <input type="date" formControlName="expiresAt" />
            </label>
            <label class="campo ancho-total">
              <span>Entidad que capacitó</span>
              <input formControlName="trainingEntity" autocomplete="off" placeholder="Opcional" />
            </label>
            <div class="acciones ancho-total">
              <button class="boton" [disabled]="formCertificado.invalid || guardando()">
                {{ guardando() ? 'Registrando…' : 'Registrar certificado' }}
              </button>
            </div>
          </form>

          <h3>Certificados registrados</h3>
          @if (certificados().length) {
            <div class="tabla-scroll">
              <table class="datos">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Vigencia</th>
                    <th>Entidad</th>
                    <th>Soporte</th>
                  </tr>
                </thead>
                <tbody>
                  @for (certificado of certificados(); track certificado.id) {
                    <tr>
                      <td>
                        <strong>
                          {{ certificado.collaborator.firstName }} {{ certificado.collaborator.lastName }}
                        </strong>
                        <span class="secundario">{{ certificado.collaborator.documentNumber }}</span>
                      </td>
                      <td>
                        {{ soloFecha(certificado.issuedAt) }}
                        <span class="secundario">hasta {{ soloFecha(certificado.expiresAt) }}</span>
                      </td>
                      <td>{{ certificado.trainingEntity || '—' }}</td>
                      <td>
                        @if (certificado.file) {
                          <button
                            class="boton secundario compacto"
                            type="button"
                            (click)="descargar(certificado.file.id, certificado.file.originalName)"
                          >
                            Ver soporte
                          </button>
                        } @else {
                          <label class="subir">
                            <input
                              type="file"
                              accept="application/pdf,image/png,image/jpeg"
                              (change)="subirSoporteCertificado(certificado.id, $event)"
                            />
                          </label>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="secundario">Todavía no hay certificados registrados.</p>
          }
        </section>
      }

      @if (pestana() === 'colaboradores') {
        <p class="mensaje alerta">
          Los perfiles de colaboradores los registra el Gestor de ARL, que administra también su afiliación. Aquí se
          consultan para revisar quién puede iniciar labores.
        </p>

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
      .area-masthead h1 {
        margin: 0 0 4px;
        font-size: clamp(1.45rem, 2.6vw, 2rem);
        letter-spacing: -0.03em;
      }
      .area-masthead p {
        margin: 0;
        color: var(--tinta-media);
        font-size: 0.875rem;
      }
      .area-tabs {
        margin: 0;
        border: 0;
        gap: 6px;
      }
      .area-tabs button {
        border: 0;
        border-radius: 999px;
        padding: 9px 14px;
      }
      .area-tabs button[aria-selected='true'] {
        background: #98cbbb;
        color: #123f38;
      }
      @media (max-width: 640px) {
        .area-masthead {
          align-items: start;
          flex-direction: column;
          padding: 18px 16px 12px;
        }
        .area-tabs {
          overflow-x: auto;
          max-width: 100%;
        }
        .area-tabs button {
          white-space: nowrap;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoordinationComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);

  readonly pestana = signal<'bandeja' | 'jornadas' | 'cumplimiento' | 'colaboradores' | 'custodia'>('bandeja');
  readonly dashboard = signal<Dashboard | null>(null);
  readonly pending = signal<Submission[]>([]);
  readonly detail = signal<Detail | null>(null);
  readonly firmaUrl = signal<string | null>(null);
  /** Firmas de la cuadrilla como URL de objeto, por id de integrante. */
  readonly firmasCuadrilla = signal<Record<string, string>>({});
  readonly motivo = signal('');
  readonly decidiendo = signal(false);
  readonly ultimoPdf = signal<string | null>(null);
  readonly colaboradores = signal<Colaborador[]>([]);
  readonly guardando = signal(false);
  readonly error = signal('');

  // ── Jornadas y requisitos ──
  readonly jornadas = signal<JornadaAbierta[]>([]);
  readonly cumplimiento = signal<FilaCumplimiento[]>([]);
  readonly planillas = signal<Planilla[]>([]);
  readonly certificados = signal<Certificado[]>([]);
  readonly cubiertos = signal<string[]>([]);
  readonly documentosCustodia = signal<DocumentoCustodia[]>([]);

  readonly formPlanilla = this.fb.nonNullable.group({
    reference: ['', [Validators.required, Validators.maxLength(100)]],
    providerName: [''],
    periodStart: ['', Validators.required],
    periodEnd: ['', Validators.required],
  });

  readonly formCertificado = this.fb.nonNullable.group({
    collaboratorId: ['', Validators.required],
    issuedAt: ['', Validators.required],
    expiresAt: ['', Validators.required],
    trainingEntity: [''],
  });
  readonly formCustodia = this.fb.nonNullable.group({ month: [''], date: [''] });
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
    jobTitle: ['', Validators.required],
    team: ['', Validators.maxLength(100)],
    email: ['', Validators.email],
    phone: ['', Validators.maxLength(30)],
    pin: [''],
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

  /** Auxiliares, ayudantes y supervisores no requieren el certificado de alturas. */
  readonly oficialesElectricos = computed(() =>
    this.cumplimiento().filter((fila) => fila.collaborator.jobTitle === 'Oficial eléctrico'),
  );
  readonly pdfsCustodia = computed(() =>
    this.documentosCustodia().filter((documento) => documento.finalPdfFile !== null),
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

  // ── Jornadas abiertas ────────────────────────────────────
  verJornadas(): void {
    this.pestana.set('jornadas');
    this.cargarJornadas();
  }

  cargarJornadas(): void {
    this.http.get<JornadaAbierta[]>('/api/coordination/open-workdays').subscribe({
      next: (lista) => this.jornadas.set(lista),
      error: () => this.error.set('No fue posible consultar las jornadas abiertas.'),
    });
  }

  // ── Custodia documental ──────────────────────────────────
  verCustodia(): void {
    this.pestana.set('custodia');
    this.cargarCustodia();
  }

  cargarCustodia(): void {
    const { month, date } = this.formCustodia.getRawValue();
    const parametros = new URLSearchParams();
    if (date) parametros.set('date', date);
    else if (month) parametros.set('month', month);
    const consulta = parametros.size ? `?${parametros.toString()}` : '';
    this.http.get<DocumentoCustodia[]>(`/api/coordination/submissions${consulta}`).subscribe({
      next: (documentos) => this.documentosCustodia.set(documentos),
      error: () => this.error.set('No fue posible consultar el archivo documental.'),
    });
  }

  limpiarCustodia(): void {
    this.formCustodia.reset({ month: '', date: '' });
    this.cargarCustodia();
  }

  descargarCustodia(): void {
    for (const documento of this.pdfsCustodia()) {
      if (documento.finalPdfFile) this.descargar(documento.finalPdfFile.id, documento.finalPdfFile.originalName);
    }
  }

  // ── Requisitos ───────────────────────────────────────────
  verCumplimiento(): void {
    this.pestana.set('cumplimiento');
    if (!this.cumplimiento().length) this.cargarCumplimiento();
    if (!this.planillas().length) this.cargarPlanillas();
    if (!this.certificados().length) this.cargarCertificados();
  }

  cargarCumplimiento(): void {
    this.http.get<{ rows: FilaCumplimiento[] }>('/api/compliance/overview').subscribe({
      next: (respuesta) => this.cumplimiento.set(respuesta.rows),
      error: () => this.error.set('No fue posible consultar el cumplimiento.'),
    });
  }

  cargarPlanillas(): void {
    this.http.get<Planilla[]>('/api/compliance/payrolls').subscribe({
      next: (lista) => this.planillas.set(lista),
      error: () => undefined,
    });
  }

  cargarCertificados(): void {
    this.http.get<Certificado[]>('/api/compliance/height-certificates').subscribe({
      next: (lista) => this.certificados.set(lista),
      error: () => undefined,
    });
  }

  estaCubierto(collaboratorId: string): boolean {
    return this.cubiertos().includes(collaboratorId);
  }

  alternarCubierto(collaboratorId: string): void {
    this.cubiertos.update((lista) =>
      lista.includes(collaboratorId) ? lista.filter((otro) => otro !== collaboratorId) : [...lista, collaboratorId],
    );
  }

  crearPlanilla(): void {
    if (this.formPlanilla.invalid || !this.cubiertos().length) return;
    this.guardando.set(true);
    this.error.set('');
    const valores = this.formPlanilla.getRawValue();
    this.http
      .post('/api/compliance/payrolls', {
        reference: valores.reference,
        providerName: valores.providerName || undefined,
        periodStart: valores.periodStart,
        periodEnd: valores.periodEnd,
        collaboratorIds: this.cubiertos(),
      })
      .subscribe({
        next: () => {
          this.aviso.set('Planilla registrada. Sus integrantes quedaron al día.');
          this.formPlanilla.reset({ reference: '', providerName: '', periodStart: '', periodEnd: '' });
          this.cubiertos.set([]);
          this.guardando.set(false);
          this.cargarPlanillas();
          this.cargarCumplimiento();
        },
        error: () => {
          this.error.set('No fue posible registrar la planilla. Revisa las fechas e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }

  crearCertificado(): void {
    if (this.formCertificado.invalid) return;
    this.guardando.set(true);
    this.error.set('');
    const valores = this.formCertificado.getRawValue();
    this.http
      .post('/api/compliance/height-certificates', {
        collaboratorId: valores.collaboratorId,
        issuedAt: valores.issuedAt,
        expiresAt: valores.expiresAt,
        trainingEntity: valores.trainingEntity || undefined,
      })
      .subscribe({
        next: () => {
          this.aviso.set('Certificado registrado.');
          this.formCertificado.reset({ collaboratorId: '', issuedAt: '', expiresAt: '', trainingEntity: '' });
          this.guardando.set(false);
          this.cargarCertificados();
          this.cargarCumplimiento();
        },
        error: () => {
          this.error.set('No fue posible registrar el certificado. Revisa las fechas e intenta de nuevo.');
          this.guardando.set(false);
        },
      });
  }

  subirSoportePlanilla(payrollId: string, evento: Event): void {
    this.subirSoporte(`/api/compliance/payrolls/${payrollId}/file`, evento, () => this.cargarPlanillas());
  }

  subirSoporteCertificado(certificateId: string, evento: Event): void {
    this.subirSoporte(`/api/compliance/height-certificates/${certificateId}/file`, evento, () =>
      this.cargarCertificados(),
    );
  }

  /** Sin Content-Type explícito: el navegador debe poner su propio separador. */
  private subirSoporte(url: string, evento: Event, alTerminar: () => void): void {
    const archivo = (evento.target as HTMLInputElement).files?.[0];
    if (!archivo) return;
    const cuerpo = new FormData();
    cuerpo.append('file', archivo);
    this.http.post(url, cuerpo).subscribe({
      next: () => {
        this.aviso.set('Soporte cargado.');
        alTerminar();
      },
      error: () => this.error.set('No fue posible cargar el soporte. Debe ser PDF, JPG o PNG de máximo 10 MB.'),
    });
  }

  claseRequisito(estado: string): string {
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    if (estado === 'NO_APLICA') return 'neutro';
    return 'vencida';
  }

  textoRequisito(estado: string): string {
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Por vencer';
    if (estado === 'NO_APLICA') return 'No aplica';
    return 'Vencida';
  }

  hora(valor: string | null): string {
    if (!valor) return '—';
    return new Date(valor).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  duracionDesde(inicio: string | null): string {
    if (!inicio) return 'Hora no registrada';
    const minutos = Math.max(0, Math.floor((Date.now() - new Date(inicio).getTime()) / 60_000));
    const horas = Math.floor(minutos / 60);
    return horas ? `${horas} h ${minutos % 60} min en labor` : `${minutos} min en labor`;
  }

  integrantesTexto(integrantes: { collaborator: { firstName: string; lastName: string } }[]): string {
    return integrantes.map((item) => `${item.collaborator.firstName} ${item.collaborator.lastName}`).join(', ');
  }

  intervaloJornada(inicio: string | null, fin: string | null): string {
    if (!inicio) return 'Sin hora de inicio';
    return fin ? `${this.hora(inicio)} a ${this.hora(fin)}` : `${this.hora(inicio)} · en curso`;
  }

  claseEstadoDocumento(estado: string): string {
    if (estado === 'CLOSED') return 'vigente';
    if (estado === 'REJECTED') return 'vencida';
    return 'por-vencer';
  }

  textoEstadoDocumento(estado: string): string {
    if (estado === 'CLOSED') return 'Cerrado';
    if (estado === 'APPROVED') return 'En curso';
    if (estado === 'PENDING_APPROVAL') return 'Pendiente';
    if (estado === 'REJECTED') return 'Rechazado';
    return estado;
  }

  abrir(id: string): void {
    this.motivo.set('');
    this.firmaUrl.set(null);
    this.http.get<Detail>(`/api/coordination/submissions/${id}`).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.cargarFirmasCuadrilla(detail.members ?? []);
      },
      error: () => this.error.set('No fue posible abrir el envío.'),
    });
  }

  cerrarRevision(): void {
    this.liberarFirmas();
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

  descargar(id: string, nombre = 'permiso-sg-sst.pdf'): void {
    this.http.get(`/api/files/${id}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = nombre;
        anchor.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el documento.'),
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

  soloFecha(valor: string | null): string {
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

  /** Descarga la firma de cada integrante para mostrarlas en la revisión. */
  private cargarFirmasCuadrilla(integrantes: Integrante[]): void {
    this.liberarFirmas();
    for (const integrante of integrantes) {
      const fileId = integrante.signature?.file.id;
      if (!fileId) continue;
      this.http.get(`/api/files/${fileId}/download`, { responseType: 'blob' }).subscribe({
        next: (blob) =>
          this.firmasCuadrilla.update((mapa) => ({ ...mapa, [integrante.id]: URL.createObjectURL(blob) })),
        error: () => undefined,
      });
    }
  }

  private liberarFirmas(): void {
    for (const url of Object.values(this.firmasCuadrilla())) URL.revokeObjectURL(url);
    this.firmasCuadrilla.set({});
  }

  private liberarFirma(): void {
    const url = this.firmaUrl();
    if (url) URL.revokeObjectURL(url);
    this.firmaUrl.set(null);
  }
}
