import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthSessionService } from '../../core/auth-session.service';
import { fechaCalendario } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';

type TipoCampo = 'text' | 'textarea' | 'yes_no' | 'select' | 'multi_select' | 'number' | 'date' | 'auto';

type Campo = {
  id: string;
  type: TipoCampo;
  label: string;
  required: boolean;
  options?: string[];
  order: number;
  section?: string;
  /** Para los campos `auto`: de dónde toma el sistema el valor. */
  source?: string;
};

type Definicion = { name: string; versionNumber: number; schemaJson: { fields: Campo[] } };

type Flujo = {
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  arl: { status: string; providerName?: string; endDate?: string };
  cumplimiento?: {
    apto: boolean;
    faltantes: string[];
    alturas?: { estado: string };
    seguridadSocial?: { estado: string };
  };
  /** Permiso autorizado y aún sin cerrar, si lo hay. */
  jornadaAbierta?: { id: string; workDate: string | null; startedAt: string | null } | false | null;
  canContinue: boolean;
};

type Envio = {
  id: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED' | 'REJECTED';
  submittedAt?: string | null;
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  approval?: { reason?: string | null } | null;
} | null;

/** Un paso del formulario: una sección del esquema publicado. */
type Bloque = { titulo: string; campos: Campo[] };

type Etapa = 'arl' | 'charla' | 'cuadrilla' | 'formulario' | 'revision' | 'firma' | 'resultado';

/** Colaborador que hoy cumple los requisitos y puede integrar la cuadrilla. */
type Candidato = {
  id: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  jobTitle: string | null;
  team: string | null;
};

type Cargo = { id: string; code: string; name: string; canLead: boolean };

/**
 * Videos disponibles para la charla previa al inicio de labores.
 * Agrega los archivos con estos nombres en `src/assets/videos/charlas-seguridad/`.
 */
const CHARLAS_DE_SEGURIDAD = [
  '/assets/videos/charlas-seguridad/charla-01.mp4',
  '/assets/videos/charlas-seguridad/charla-02.mp4',
  '/assets/videos/charlas-seguridad/charla-03.mp4',
];

/** Integrante elegido, con su cargo y su firma una vez capturada. */
type Integrante = {
  candidato: Candidato;
  jobPositionId: string;
  firmaDataUrl: string | null;
};

const BORRADOR = 'sg-sst.borrador';

/**
 * Flujo previo al inicio de labores.
 *
 * Se recorre de pie, en obra y desde un celular, así que cada pantalla plantea
 * una sola tarea, el avance está siempre a la vista y lo diligenciado se guarda
 * en el dispositivo por si la aplicación se cierra a media jornada.
 */
@Component({
  imports: [ReactiveFormsModule, LogoutButtonComponent],
  template: `
    <header class="paso-cabecera">
      <div class="fila">
        <span class="titulo">
          Permiso de trabajo en altura
          <span class="contador">{{ rotuloEtapa() }}</span>
        </span>
        <sg-logout-button />
      </div>
      <div
        class="progreso"
        role="progressbar"
        [attr.aria-valuenow]="porcentaje()"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <div class="avance" [style.width.%]="porcentaje()"></div>
      </div>
    </header>

    <main class="flujo">
      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }

      <!-- ═══ 1. Estado de ARL ═══ -->
      @if (etapa() === 'arl') {
        @if (flujo(); as datos) {
          <h1 class="paso-titulo">Hola, {{ datos.collaborator.firstName }}</h1>
          <p class="paso-ayuda">Antes de iniciar labores verificamos que tus requisitos estén vigentes.</p>

          <div class="bloque">
            <div class="titulo-seccion">
              <h2>Afiliación a la ARL</h2>
              <span class="distintivo" [class]="claseArl()">{{ textoArl() }}</span>
            </div>
            <dl class="detalle-arl">
              <div>
                <dt>Administradora</dt>
                <dd>{{ datos.arl.providerName || 'Sin afiliación registrada' }}</dd>
              </div>
              @if (datos.arl.endDate) {
                <div>
                  <dt>Vigente hasta</dt>
                  <dd>{{ soloFecha(datos.arl.endDate) }}</dd>
                </div>
              }
            </dl>

            @if (!datos.canContinue) {
              <p class="mensaje error">
                No puedes continuar porque falta actualizar: {{ requisitosPendientes() }}. Comunícate con tu
                coordinadora.
              </p>
            } @else if (datos.arl.status === 'PROXIMA_A_VENCER') {
              <p class="mensaje alerta">
                Tu afiliación vence pronto. Puedes continuar hoy, pero avisa a tu coordinadora.
              </p>
            }
          </div>
        } @else if (!error()) {
          <p class="paso-ayuda">Consultando tu información…</p>
        }
      }

      <!-- ═══ 2. Charla de seguridad ═══ -->
      @if (etapa() === 'charla') {
        <h1 class="paso-titulo">Charla de seguridad</h1>
        <p class="paso-ayuda">Mira la charla completa antes de continuar con el permiso.</p>

        <div class="bloque charla-video">
          <video
            #videoCharla
            class="reproductor-charla"
            [src]="charlaActual()"
            playsinline
            preload="metadata"
            controlsList="nodownload noplaybackrate noremoteplayback"
            disablePictureInPicture
            (timeupdate)="registrarProgresoCharla()"
            (seeking)="bloquearAdelanto()"
            (ended)="finalizarCharla()"
            (error)="reportarErrorVideo()"
          ></video>

          @if (!charlaTerminada()) {
            <p class="estado-charla" aria-live="polite">
              Debes reproducir el video completo. No es posible adelantarlo.
            </p>
          } @else {
            <p class="estado-charla completada" role="status">Charla completada. Puedes repetirla o continuar.</p>
          }

          <div class="acciones charla-acciones">
            <button class="boton" type="button" (click)="reproducirCharla()">
              {{ charlaTerminada() ? 'Repetir charla' : 'Reproducir charla' }}
            </button>
          </div>

          <label class="casilla declaracion-charla" [class.deshabilitada]="!charlaTerminada()">
            <input
              type="checkbox"
              [checked]="charlaConfirmada()"
              [disabled]="!charlaTerminada()"
              (change)="charlaConfirmada.set($any($event.target).checked)"
            />
            <span>Declaro haber visto y entendido las indicaciones de seguridad de esta charla.</span>
          </label>
        </div>
      }

      <!-- ═══ 3. Cuadrilla ═══ -->
      @if (etapa() === 'cuadrilla') {
        <h1 class="paso-titulo">¿Quiénes trabajan hoy?</h1>
        <p class="paso-ayuda">Elige a los integrantes de tu cuadrilla. Cada uno firmará su permiso antes de enviar.</p>

        @if (excluidos() > 0) {
          <p class="mensaje alerta">
            {{ excluidos() }}
            {{ excluidos() === 1 ? 'colaborador no aparece' : 'colaboradores no aparecen' }} en la lista porque tienen
            vencida la ARL, la seguridad social o el certificado de alturas. Avisa a tu coordinadora.
          </p>
        }

        <div class="bloque">
          <div class="titulo-seccion">
            <h2>
              Integrantes <span class="conteo">({{ integrantes().length }})</span>
            </h2>
          </div>

          @if (candidatos().length) {
            <div class="casillas">
              @for (persona of candidatos(); track persona.id) {
                <label class="casilla">
                  <input
                    type="checkbox"
                    [checked]="estaEnCuadrilla(persona.id)"
                    [disabled]="persona.id === yoId()"
                    (change)="alternarIntegrante(persona)"
                  />
                  <span>
                    {{ persona.firstName }} {{ persona.lastName }}
                    <span class="secundario">
                      {{ persona.documentNumber }}
                      @if (persona.id === yoId()) {
                        · tú diligencias este permiso
                      }
                    </span>
                  </span>
                </label>
              }
            </div>
          } @else {
            <p class="secundario">No hay colaboradores disponibles hoy. Comunícate con tu coordinadora.</p>
          }
        </div>

        @if (integrantes().length) {
          <div class="bloque">
            <div class="titulo-seccion">
              <h2>Cargo de cada integrante</h2>
            </div>
            @for (integrante of integrantes(); track integrante.candidato.id) {
              <label class="campo">
                <span>{{ integrante.candidato.firstName }} {{ integrante.candidato.lastName }}</span>
                @if (cargos().length) {
                  <select
                    [value]="integrante.jobPositionId"
                    (change)="asignarCargo(integrante.candidato.id, $any($event.target).value)"
                  >
                    <!-- La marca va en la opción: el valor del select se aplica
                         antes de que las opciones existan y no seleccionaría. -->
                    @for (cargo of cargos(); track cargo.id) {
                      <option [value]="cargo.id" [selected]="cargo.id === integrante.jobPositionId">
                        {{ cargo.name }}
                      </option>
                    }
                  </select>
                } @else {
                  <span class="error-campo">No hay cargos configurados. Comunícate con tu coordinadora.</span>
                }
              </label>
            }
          </div>
        }
      }

      <!-- ═══ 3. Formulario por secciones ═══ -->
      @if (etapa() === 'formulario' && bloqueActual(); as bloque) {
        <h1 class="paso-titulo">{{ bloque.titulo }}</h1>
        <p class="paso-ayuda">
          Sección {{ indiceBloque() + 1 }} de {{ bloques().length }} · los campos con
          <span aria-hidden="true">*</span> son obligatorios
        </p>

        @if (faltantes().length) {
          <p class="mensaje error" role="alert">
            Faltan {{ faltantes().length }}
            {{ faltantes().length === 1 ? 'respuesta obligatoria' : 'respuestas obligatorias' }} en esta sección.
          </p>
        }

        <form [formGroup]="respuestas" class="bloque">
          @for (campo of bloque.campos; track campo.id; let i = $index) {
            @if (debeMostrarCampo(campo.id)) {
              @if (campo.type === 'auto') {
                <div class="campo automatico">
                  <span>{{ campo.label }}</span>
                  <p class="valor-auto">
                    {{ valorAutomatico(campo) }}
                    <span class="secundario">{{ explicacionAuto(campo) }}</span>
                  </p>
                </div>
              } @else if (esBotonera(campo)) {
                <div class="pregunta" [class.invalido]="invalido(campo)">
                  <span class="enunciado" [id]="campo.id + '-etiqueta'">
                    @if (bloque.campos.length > 6) {
                      <span class="numero">{{ i + 1 }}.</span>
                    }
                    {{ campo.label }}
                    @if (campo.required) {
                      <span aria-hidden="true">*</span>
                    }
                  </span>
                  <div class="opciones" role="group" [attr.aria-labelledby]="campo.id + '-etiqueta'">
                    @for (opcion of opcionesDe(campo); track opcion) {
                      <button
                        type="button"
                        class="opcion"
                        [class.negativa]="opcion === 'NO'"
                        [class.neutra]="opcion === 'N/A'"
                        [attr.aria-pressed]="valor(campo.id) === opcion"
                        (click)="elegir(campo.id, opcion)"
                      >
                        {{ textoOpcion(opcion) }}
                      </button>
                    }
                  </div>
                  @if (invalido(campo)) {
                    <span class="error-campo">Selecciona una opción.</span>
                  }
                </div>
              } @else if (campo.type === 'multi_select') {
                <div class="campo" [class.invalido]="invalido(campo)">
                  <span [id]="campo.id + '-etiqueta'"
                    >{{ campo.label }}
                    @if (campo.required) {
                      <span aria-hidden="true">*</span>
                    }
                  </span>
                  <div class="casillas" role="group" [attr.aria-labelledby]="campo.id + '-etiqueta'">
                    @for (opcion of campo.options; track opcion) {
                      <label class="casilla">
                        <input
                          type="checkbox"
                          [checked]="tieneOpcion(campo.id, opcion)"
                          (change)="alternar(campo.id, opcion)"
                        />
                        {{ opcion }}
                      </label>
                    }
                  </div>
                  @if (invalido(campo)) {
                    <span class="error-campo">Selecciona al menos una opción.</span>
                  }
                </div>
              } @else if (campo.type === 'select') {
                <label class="campo" [class.invalido]="invalido(campo)">
                  <span
                    >{{ campo.label }}
                    @if (campo.required) {
                      <span aria-hidden="true">*</span>
                    }
                  </span>
                  <select [formControlName]="campo.id">
                    <option value="">Selecciona una opción</option>
                    @for (opcion of campo.options; track opcion) {
                      <option [value]="opcion">{{ opcion }}</option>
                    }
                  </select>
                  @if (invalido(campo)) {
                    <span class="error-campo">Este campo es obligatorio.</span>
                  }
                </label>
              } @else {
                <label class="campo" [class.invalido]="invalido(campo)">
                  <span
                    >{{ campo.label }}
                    @if (campo.required) {
                      <span aria-hidden="true">*</span>
                    }
                  </span>
                  @if (campo.type === 'textarea') {
                    <textarea rows="3" [formControlName]="campo.id"></textarea>
                  } @else {
                    <input
                      [type]="campo.type === 'number' ? 'number' : campo.type === 'date' ? 'date' : 'text'"
                      [formControlName]="campo.id"
                    />
                  }
                  @if (invalido(campo)) {
                    <span class="error-campo">Este campo es obligatorio.</span>
                  }
                </label>
              }
            }
          }
        </form>
      }

      <!-- ═══ 4. Revisión ═══ -->
      @if (etapa() === 'revision') {
        <h1 class="paso-titulo">Revisa antes de firmar</h1>
        <p class="paso-ayuda">Una vez firmes y envíes, el permiso no se puede modificar.</p>

        @if (negativas().length) {
          <p class="mensaje alerta">
            Respondiste <strong>NO</strong> en {{ negativas().length }}
            {{ negativas().length === 1 ? 'punto' : 'puntos' }} de la lista de verificación. Coordinación lo verá al
            revisar.
          </p>
        }

        @for (bloque of bloques(); track bloque.titulo) {
          <section class="bloque">
            <div class="titulo-seccion">
              <h2>{{ bloque.titulo }}</h2>
              <button class="boton secundario compacto" type="button" (click)="volverA(bloque)">Corregir</button>
            </div>
            <div class="tabla-scroll">
              <table class="datos">
                <tbody>
                  @for (campo of bloque.campos; track campo.id) {
                    <tr [class.fila-alerta]="valor(campo.id) === 'NO'">
                      <th scope="row" class="campo-nombre">{{ campo.label }}</th>
                      <td>{{ textoValor(campo.id) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
      }

      <!-- ═══ 5. Firma ═══ -->
      @if (etapa() === 'firma') {
        @if (firmante(); as persona) {
          <h1 class="paso-titulo">Firma {{ persona.candidato.firstName }} {{ persona.candidato.lastName }}</h1>
          <p class="paso-ayuda">
            Firmante {{ indiceFirma() + 1 }} de {{ integrantes().length }}. Pásale el dispositivo y que firme dentro del
            recuadro: confirma que la información es verdadera.
          </p>

          <div class="bloque">
            <p class="secundario documento-firmante">
              {{ persona.candidato.documentNumber }} · {{ nombreCargo(persona.jobPositionId) }}
            </p>
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
              <button class="boton secundario compacto" type="button" (click)="limpiarFirma()" [disabled]="!hayFirma()">
                Borrar y firmar de nuevo
              </button>
            </div>
            @if (!hayFirma()) {
              <p class="secundario">Aún no ha firmado.</p>
            }
          </div>

          @if (firmadas() > 0) {
            <p class="secundario centrado">
              {{ firmadas() }} de {{ integrantes().length }}
              {{ firmadas() === 1 ? 'firma capturada' : 'firmas capturadas' }}
            </p>
          }
        }
      }

      <!-- ═══ 6. Resultado ═══ -->
      @if (etapa() === 'resultado') {
        @if (envio(); as resultado) {
          @if (resultado.status === 'APPROVED') {
            <div class="resultado aprobado">
              <span class="simbolo" aria-hidden="true">✓</span>
              <h2>Autorizado para iniciar labores</h2>
              <p>Coordinación aprobó el permiso. Al terminar, cierra la jornada desde aquí.</p>
            </div>

            <div class="bloque jornada">
              <div class="titulo-seccion">
                <h2>Cerrar la jornada</h2>
              </div>
              <p class="secundario">
                Inició a las {{ hora(resultado.startedAt) }}. La hora de finalización se registra al cerrar y el permiso
                queda completo con su documento final.
              </p>
              <label class="campo">
                <span>Novedades de la jornada</span>
                <textarea
                  rows="2"
                  [value]="novedades()"
                  (input)="novedades.set($any($event.target).value)"
                  placeholder="Opcional. Queda en el documento final."
                ></textarea>
              </label>
              <div class="acciones">
                <button class="boton" type="button" [disabled]="cerrando()" (click)="cerrarJornada(resultado.id)">
                  {{ cerrando() ? 'Cerrando…' : 'Terminamos: cerrar jornada' }}
                </button>
              </div>
            </div>
          } @else if (resultado.status === 'CLOSED') {
            <div class="resultado aprobado">
              <span class="simbolo" aria-hidden="true">✓</span>
              <h2>Jornada cerrada</h2>
              <p>
                De {{ hora(resultado.startedAt) }} a {{ hora(resultado.closedAt) }}. El permiso quedó completo y
                archivado.
              </p>
            </div>
          } @else if (resultado.status === 'REJECTED') {
            <div class="resultado rechazado">
              <span class="simbolo" aria-hidden="true">✕</span>
              <h2>Permiso rechazado</h2>
              <p>{{ resultado.approval?.reason || 'Comunícate con tu coordinadora.' }}</p>
            </div>
          } @else {
            <div class="resultado pendiente">
              <span class="simbolo" aria-hidden="true">•••</span>
              <h2>Enviado. Espera la autorización</h2>
              <p>Tu coordinadora debe revisarlo. No inicies labores hasta ver la luz verde.</p>
            </div>
          }

          <div class="acciones centrado">
            <button class="boton secundario" type="button" (click)="consultarEstado()" [disabled]="consultando()">
              {{ consultando() ? 'Consultando…' : 'Actualizar estado' }}
            </button>
          </div>
          @if (resultado.status === 'PENDING_APPROVAL') {
            <p class="secundario centrado">El estado se actualiza solo cada 20 segundos.</p>
          }
        }
      }
    </main>

    <!-- ═══ Barra de acción ═══ -->
    @if (etapa() !== 'resultado') {
      <div class="pie-accion">
        <div class="fila">
          @if (puedeRetroceder()) {
            <button class="boton secundario" type="button" (click)="atras()">Atrás</button>
          }
          @switch (etapa()) {
            @case ('firma') {
              <button class="boton" type="button" [disabled]="!hayFirma() || enviando()" (click)="confirmarFirma()">
                @if (enviando()) {
                  Enviando…
                } @else if (esUltimoFirmante()) {
                  Firmar y enviar permiso
                } @else {
                  Guardar firma y continuar
                }
              </button>
            }
            @case ('revision') {
              <button class="boton" type="button" (click)="etapa.set('firma')">Continuar a la firma</button>
            }
            @default {
              <button class="boton" type="button" [disabled]="!puedeAvanzar()" (click)="siguiente()">Continuar</button>
            }
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .detalle-arl {
        display: grid;
        gap: 14px;
        margin: 0;
      }
      .detalle-arl dt {
        color: var(--tinta-suave);
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .detalle-arl dd {
        margin: 2px 0 0;
        font-size: 1.0625rem;
      }
      .pregunta-principal {
        margin: 0 0 16px;
        font-size: 1.125rem;
        font-weight: 600;
      }
      .charla-video {
        display: grid;
        gap: 16px;
      }
      .reproductor-charla {
        display: block;
        width: 100%;
        max-height: 58vh;
        background: #101a1d;
        border-radius: var(--radio);
      }
      .estado-charla {
        margin: 0;
        color: var(--tinta-media);
        font-weight: 600;
      }
      .estado-charla.completada {
        color: var(--ok);
      }
      .charla-acciones {
        margin-top: -4px;
      }
      .declaracion-charla {
        align-items: flex-start;
      }
      .declaracion-charla.deshabilitada {
        cursor: not-allowed;
        opacity: 0.62;
      }
      .campo-nombre {
        width: 46%;
        color: var(--tinta-media);
        font-weight: 600;
      }
      .fila-alerta {
        background: var(--error-fondo);
      }
      .fila-alerta .campo-nombre {
        color: var(--error);
      }
      .secundario {
        color: var(--tinta-suave);
        font-size: 0.9375rem;
      }
      .automatico .valor-auto {
        margin: 0;
        padding: 12px 14px;
        border: 1px dashed var(--borde-fuerte);
        border-radius: var(--radio);
        background: var(--fondo);
        font-weight: 600;
      }
      .automatico .valor-auto .secundario {
        display: block;
        font-weight: 400;
        font-size: 0.8125rem;
      }
      .centrado {
        justify-content: center;
        text-align: center;
        margin-top: 18px;
      }
      .bloque .campo,
      .bloque .pregunta {
        margin-bottom: 4px;
      }
      form.bloque {
        display: grid;
        gap: 18px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkAtHeightFormComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  @ViewChild('lienzo') lienzo?: ElementRef<HTMLCanvasElement>;
  @ViewChild('videoCharla') videoCharla?: ElementRef<HTMLVideoElement>;

  readonly etapa = signal<Etapa>('arl');
  readonly flujo = signal<Flujo | null>(null);
  readonly definicion = signal<Definicion | null>(null);
  readonly charlaActual = signal(CHARLAS_DE_SEGURIDAD[Math.floor(Math.random() * CHARLAS_DE_SEGURIDAD.length)]);
  readonly charlaTerminada = signal(false);
  readonly charlaConfirmada = signal(false);
  private ultimoSegundoPermitido = 0;
  readonly indiceBloque = signal(0);
  readonly faltantes = signal<string[]>([]);
  readonly hayFirma = signal(false);
  readonly enviando = signal(false);
  readonly consultando = signal(false);
  readonly envio = signal<Envio>(null);
  readonly error = signal('');

  // ── Cuadrilla y firmas ──
  readonly candidatos = signal<Candidato[]>([]);
  readonly cargos = signal<Cargo[]>([]);
  readonly excluidos = signal(0);
  readonly integrantes = signal<Integrante[]>([]);
  readonly indiceFirma = signal(0);
  readonly yoId = signal<string | null>(null);

  // ── Cierre de jornada ──
  readonly novedades = signal('');
  readonly cerrando = signal(false);

  /** A quién le toca firmar ahora. */
  readonly firmante = computed<Integrante | null>(() => this.integrantes()[this.indiceFirma()] ?? null);
  readonly firmadas = computed(() => this.integrantes().filter((persona) => persona.firmaDataUrl).length);
  readonly esUltimoFirmante = computed(() => this.indiceFirma() >= this.integrantes().length - 1);

  readonly respuestas = new FormGroup<Record<string, FormControl<unknown>>>({});

  private dibujando = false;
  private sondeo?: ReturnType<typeof setInterval>;

  /** Cada sección del esquema publicado es un paso del formulario. */
  readonly bloques = computed<Bloque[]>(() => {
    const campos = (this.definicion()?.schemaJson.fields ?? []).slice().sort((a, b) => a.order - b.order);
    const bloques: Bloque[] = [];
    let titulo = 'Datos del permiso';
    for (const campo of campos) {
      if (campo.section) titulo = campo.section;
      const bloque = bloques.find((candidato) => candidato.titulo === titulo);
      if (bloque) bloque.campos.push(campo);
      else bloques.push({ titulo, campos: [campo] });
    }
    return bloques;
  });

  readonly bloqueActual = computed<Bloque | null>(() => this.bloques()[this.indiceBloque()] ?? null);

  readonly negativas = computed(() =>
    this.bloques()
      .flatMap((bloque) => bloque.campos)
      .filter((campo) => this.valor(campo.id) === 'NO'),
  );

  readonly puedeRetroceder = computed(() => {
    const etapa = this.etapa();
    if (etapa === 'charla') return true;
    if (etapa === 'formulario') return this.indiceBloque() > 0 || true;
    return etapa === 'revision' || etapa === 'firma';
  });

  readonly porcentaje = computed(() => {
    const total = 4 + this.bloques().length; // ARL, charla, cuadrilla, secciones, revisión y firma
    const orden: Record<Etapa, number> = {
      arl: 0,
      charla: 1,
      cuadrilla: 2,
      formulario: 3 + this.indiceBloque(),
      revision: 3 + this.bloques().length,
      firma: 4 + this.bloques().length,
      resultado: total + 1,
    };
    return Math.min(100, Math.round((orden[this.etapa()] / (total + 1)) * 100));
  });

  readonly rotuloEtapa = computed(() => {
    switch (this.etapa()) {
      case 'arl':
        return 'Verificación de ARL';
      case 'charla':
        return 'Charla de seguridad';
      case 'cuadrilla':
        return 'Cuadrilla del día';
      case 'formulario':
        return `${this.bloqueActual()?.titulo ?? ''} · ${this.indiceBloque() + 1} de ${this.bloques().length}`;
      case 'revision':
        return 'Revisión final';
      case 'firma':
        return `Firmas · ${this.indiceFirma() + 1} de ${this.integrantes().length}`;
      default:
        return 'Resultado';
    }
  });

  constructor() {
    this.cargar();
  }

  ngOnDestroy(): void {
    clearInterval(this.sondeo);
  }

  // ── Navegación ───────────────────────────────────────────
  puedeAvanzar(): boolean {
    const etapa = this.etapa();
    if (etapa === 'arl') return this.flujo()?.canContinue === true;
    if (etapa === 'charla') return this.charlaTerminada() && this.charlaConfirmada();
    // Al menos el oficial; el resto de la cuadrilla es opcional.
    if (etapa === 'cuadrilla') return this.integrantes().length > 0;
    return true;
  }

  siguiente(): void {
    const etapa = this.etapa();
    if (etapa === 'arl') return this.etapa.set('charla');
    if (etapa === 'charla') return this.etapa.set('cuadrilla');
    if (etapa === 'cuadrilla') return this.etapa.set('formulario');
    if (etapa !== 'formulario') return;

    // Solo se valida la sección visible: exigir el formulario completo aquí
    // dejaría al colaborador atascado sin saber qué falta ni dónde.
    const pendientes = (this.bloqueActual()?.campos ?? []).filter((campo) => this.faltaValor(campo));
    this.faltantes.set(pendientes.map((campo) => campo.id));
    if (pendientes.length) {
      this.enfocar(pendientes[0].id);
      return;
    }
    this.guardarBorrador();
    if (this.indiceBloque() + 1 < this.bloques().length) {
      this.indiceBloque.update((indice) => indice + 1);
      globalThis.scrollTo({ top: 0 });
      return;
    }
    this.etapa.set('revision');
    globalThis.scrollTo({ top: 0 });
  }

  atras(): void {
    this.faltantes.set([]);
    const etapa = this.etapa();
    if (etapa === 'charla') return this.etapa.set('arl');
    if (etapa === 'cuadrilla') return this.etapa.set('charla');
    if (etapa === 'firma') {
      if (this.indiceFirma() > 0) {
        this.indiceFirma.update((indice) => indice - 1);
        this.limpiarFirma();
        return;
      }
      return this.etapa.set('revision');
    }
    if (etapa === 'revision') {
      this.indiceBloque.set(this.bloques().length - 1);
      return this.etapa.set('formulario');
    }
    if (etapa === 'formulario') {
      if (this.indiceBloque() === 0) return this.etapa.set('cuadrilla');
      this.indiceBloque.update((indice) => indice - 1);
    }
  }

  volverA(bloque: Bloque): void {
    const indice = this.bloques().findIndex((candidato) => candidato.titulo === bloque.titulo);
    if (indice < 0) return;
    this.indiceBloque.set(indice);
    this.etapa.set('formulario');
    globalThis.scrollTo({ top: 0 });
  }

  reproducirCharla(): void {
    const video = this.videoCharla?.nativeElement;
    if (!video) return;
    if (this.charlaTerminada()) {
      video.currentTime = 0;
      this.charlaTerminada.set(false);
      this.charlaConfirmada.set(false);
    }
    void video.play().catch(() => {
      this.error.set('No fue posible reproducir la charla. Inténtalo de nuevo.');
    });
  }

  bloquearAdelanto(): void {
    const video = this.videoCharla?.nativeElement;
    if (!video || this.charlaTerminada()) return;
    if (video.currentTime > this.ultimoSegundoPermitido + 1) video.currentTime = this.ultimoSegundoPermitido;
  }

  registrarProgresoCharla(): void {
    const video = this.videoCharla?.nativeElement;
    if (video && !video.seeking) this.ultimoSegundoPermitido = Math.max(this.ultimoSegundoPermitido, video.currentTime);
  }

  finalizarCharla(): void {
    this.charlaTerminada.set(true);
    this.ultimoSegundoPermitido = 0;
    this.error.set('');
  }

  reportarErrorVideo(): void {
    this.error.set('No se encontró la charla de seguridad. Verifica que los videos estén en la carpeta configurada.');
  }

  // ── Cuadrilla ────────────────────────────────────────────
  estaEnCuadrilla(collaboratorId: string): boolean {
    return this.integrantes().some((persona) => persona.candidato.id === collaboratorId);
  }

  alternarIntegrante(candidato: Candidato): void {
    // El oficial no puede quitarse: es quien responde por el permiso.
    if (candidato.id === this.yoId()) return;
    this.integrantes.update((lista) =>
      lista.some((persona) => persona.candidato.id === candidato.id)
        ? lista.filter((persona) => persona.candidato.id !== candidato.id)
        : [...lista, { candidato, jobPositionId: this.cargoPorDefecto(candidato), firmaDataUrl: null }],
    );
  }

  asignarCargo(collaboratorId: string, jobPositionId: string): void {
    this.integrantes.update((lista) =>
      lista.map((persona) => (persona.candidato.id === collaboratorId ? { ...persona, jobPositionId } : persona)),
    );
  }

  /** Lo que el sistema pondrá en un campo automático, mostrado por adelantado. */
  valorAutomatico(campo: Campo): string {
    const ahora = new Date();
    const cumplimiento = this.flujo()?.cumplimiento;
    switch (campo.source) {
      case 'workDate':
        return ahora.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
      case 'startedAt':
        return ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      case 'closedAt':
        return 'Se registra al cerrar la jornada';
      case 'heightCertificate':
        return this.textoRequisito(cumplimiento?.alturas?.estado);
      case 'socialSecurity':
        return this.textoRequisito(cumplimiento?.seguridadSocial?.estado);
      default:
        return '—';
    }
  }

  explicacionAuto(campo: Campo): string {
    switch (campo.source) {
      case 'workDate':
        return 'El permiso rige solo hoy.';
      case 'startedAt':
        return 'Es la hora en que estás diligenciando.';
      case 'closedAt':
        return 'Cuando terminen, cierra la jornada desde la app.';
      case 'heightCertificate':
      case 'socialSecurity':
        return 'Verificado con lo que cargó Coordinación.';
      default:
        return '';
    }
  }

  private textoRequisito(estado?: string): string {
    if (estado === 'VIGENTE') return 'Vigente y verificado';
    if (estado === 'PROXIMA_A_VENCER') return 'Vigente, próximo a vencer';
    return 'No vigente';
  }

  nombreCargo(jobPositionId: string): string {
    return this.cargos().find((cargo) => cargo.id === jobPositionId)?.name ?? 'Sin cargo';
  }

  // ── Firma guiada, una persona a la vez ───────────────────
  /**
   * Guarda la firma del integrante actual y pasa al siguiente. Cuando ya
   * firmaron todos, envía el permiso completo.
   */
  confirmarFirma(): void {
    const lienzo = this.lienzo?.nativeElement;
    const actual = this.firmante();
    if (!lienzo || !actual || !this.hayFirma()) return;

    const dataUrl = this.firmaSobreBlanco(lienzo);
    this.integrantes.update((lista) =>
      lista.map((persona) =>
        persona.candidato.id === actual.candidato.id ? { ...persona, firmaDataUrl: dataUrl } : persona,
      ),
    );

    if (!this.esUltimoFirmante()) {
      this.indiceFirma.update((indice) => indice + 1);
      this.limpiarFirma();
      globalThis.scrollTo({ top: 0 });
      return;
    }
    this.enviar();
  }

  // ── Cierre de jornada ────────────────────────────────────
  cerrarJornada(submissionId: string): void {
    if (this.cerrando()) return;
    this.cerrando.set(true);
    this.error.set('');
    this.http
      .post<Envio>(`/api/submissions/${submissionId}/close`, { notes: this.novedades().trim() || undefined })
      .subscribe({
        next: (resultado) => {
          this.envio.set(resultado);
          this.cerrando.set(false);
          globalThis.scrollTo({ top: 0 });
        },
        error: () => {
          this.error.set('No fue posible cerrar la jornada. Revisa tu conexión e inténtalo de nuevo.');
          this.cerrando.set(false);
        },
      });
  }

  hora(valor: string | null | undefined): string {
    if (!valor) return '—';
    return new Date(valor).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  }

  /** El oficial diligencia el permiso y el resto de la cuadrilla inicia como ayudante. */
  private cargoPorDefecto(candidato: Candidato): string {
    const lista = this.cargos();
    const esLider = candidato.id === this.yoId();
    const preferido = esLider
      ? (lista.find((cargo) => cargo.code === 'OFICIAL_ELECTRICO') ?? lista.find((cargo) => cargo.canLead))
      : (lista.find((cargo) => cargo.code === 'AYUDANTE') ?? lista.find((cargo) => !cargo.canLead));
    return (preferido ?? lista[0])?.id ?? '';
  }

  // ── Campos ───────────────────────────────────────────────
  esBotonera(campo: Campo): boolean {
    if (campo.type === 'yes_no') return true;
    // Un desplegable de pocas opciones cortas se responde mejor con botones.
    return campo.type === 'select' && (campo.options?.length ?? 0) <= 3;
  }

  /** El tipo `yes_no` no declara opciones en el esquema: las aporta la vista. */
  opcionesDe(campo: Campo): string[] {
    return campo.type === 'yes_no' ? ['SI', 'NO'] : (campo.options ?? []);
  }

  textoOpcion(opcion: string): string {
    if (opcion === 'SI') return 'Sí';
    if (opcion === 'NO') return 'No';
    return opcion;
  }

  valor(id: string): unknown {
    return this.respuestas.get(id)?.value;
  }

  textoValor(id: string): string {
    const campo = this.bloques()
      .flatMap((bloque) => bloque.campos)
      .find((candidato) => candidato.id === id);
    if (campo?.type === 'auto') return this.valorAutomatico(campo);
    const valor = this.valor(id);
    if (valor === null || valor === undefined || valor === '') return '—';
    if (Array.isArray(valor)) return valor.length ? valor.join(', ') : '—';
    return this.textoOpcion(String(valor));
  }

  elegir(id: string, opcion: string): void {
    this.respuestas.get(id)?.setValue(opcion);
    if (id === 'epp_otros' && opcion !== 'SI') this.respuestas.get('epp_otros_detalle')?.setValue('');
    if (id === 'otras_tar_involucradas' && opcion !== 'SI') {
      this.respuestas.get('otras_tar')?.setValue([]);
      this.respuestas.get('otras_tar_detalle')?.setValue('');
    }
    this.descartarFaltante(id);
  }

  /** Muestra los campos de detalle solo cuando la respuesta que los activa está seleccionada. */
  debeMostrarCampo(id: string): boolean {
    if (id === 'otras_tar') return this.valor('otras_tar_involucradas') === 'SI';
    if (id === 'otras_tar_detalle') return this.tieneOpcion('otras_tar', 'Otras');
    if (id === 'epp_otros_detalle') return this.valor('epp_otros') === 'SI';
    return true;
  }

  tieneOpcion(id: string, opcion: string): boolean {
    const valor = this.valor(id);
    return Array.isArray(valor) && valor.includes(opcion);
  }

  alternar(id: string, opcion: string): void {
    const control = this.respuestas.get(id);
    const actual = Array.isArray(control?.value) ? [...(control.value as string[])] : [];
    const indice = actual.indexOf(opcion);
    if (indice >= 0) {
      actual.splice(indice, 1);
      // Un detalle oculto no debe viajar como respuesta si ya no se marcó “Otras”.
      if (id === 'otras_tar' && opcion === 'Otras') this.respuestas.get('otras_tar_detalle')?.setValue('');
    } else actual.push(opcion);
    control?.setValue(actual);
    this.descartarFaltante(id);
  }

  invalido(campo: Campo): boolean {
    return this.faltantes().includes(campo.id);
  }

  // ── Firma ────────────────────────────────────────────────
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
    this.lienzo?.nativeElement.getContext('2d')?.beginPath();
    if (this.lienzo?.nativeElement.hasPointerCapture(evento.pointerId)) {
      this.lienzo.nativeElement.releasePointerCapture(evento.pointerId);
    }
  }

  limpiarFirma(): void {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo) return;
    lienzo.getContext('2d')?.clearRect(0, 0, lienzo.width, lienzo.height);
    this.hayFirma.set(false);
  }

  /** Ajusta el búfer del lienzo al tamaño real que ocupa en pantalla. */
  private prepararLienzo(): HTMLCanvasElement | null {
    const lienzo = this.lienzo?.nativeElement;
    if (!lienzo) return null;
    const marco = lienzo.getBoundingClientRect();
    const escala = Math.min(globalThis.devicePixelRatio || 1, 2);
    const ancho = Math.round(marco.width * escala);
    const alto = Math.round(marco.height * escala);
    // Redimensionar borra el trazo, así que solo se hace antes del primero.
    if (!this.hayFirma() && (lienzo.width !== ancho || lienzo.height !== alto)) {
      lienzo.width = ancho;
      lienzo.height = alto;
    }
    return lienzo;
  }

  // ── Envío ────────────────────────────────────────────────
  enviar(): void {
    const cuadrilla = this.integrantes();
    if (this.enviando() || !cuadrilla.every((persona) => persona.firmaDataUrl)) return;
    this.enviando.set(true);
    this.error.set('');
    this.http
      .post<Envio>('/api/submissions/forms/HSE-FO-016', {
        answers: this.respuestasNormalizadas(),
        safetyTalkConfirmed: true,
        members: cuadrilla.map((persona) => ({
          collaboratorId: persona.candidato.id,
          jobPositionId: persona.jobPositionId || undefined,
          signatureDataUrl: persona.firmaDataUrl,
        })),
      })
      .subscribe({
        next: (resultado) => {
          this.envio.set(resultado);
          this.enviando.set(false);
          this.etapa.set('resultado');
          this.borrarBorrador();
          this.sondearEstado();
          globalThis.scrollTo({ top: 0 });
        },
        error: () => {
          this.error.set('No fue posible enviar el permiso. Revisa tu conexión e inténtalo de nuevo.');
          this.enviando.set(false);
        },
      });
  }

  consultarEstado(): void {
    this.consultando.set(true);
    this.http.get<Envio>('/api/submissions/mine/latest').subscribe({
      next: (resultado) => {
        this.envio.set(resultado);
        this.consultando.set(false);
        if (resultado && resultado.status !== 'PENDING_APPROVAL') clearInterval(this.sondeo);
      },
      error: () => this.consultando.set(false),
    });
  }

  soloFecha(valor: string): string {
    return fechaCalendario(valor, true);
  }

  claseArl(): string {
    const estado = this.flujo()?.arl.status;
    if (estado === 'VIGENTE') return 'vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'por-vencer';
    return 'vencida';
  }

  textoArl(): string {
    const estado = this.flujo()?.arl.status;
    if (estado === 'VIGENTE') return 'Vigente';
    if (estado === 'PROXIMA_A_VENCER') return 'Próxima a vencer';
    return 'Vencida';
  }

  /** Indica el requisito real que bloquea el permiso; no atribuye el bloqueo a la ARL si está vigente. */
  requisitosPendientes(): string {
    const faltantes = this.flujo()?.cumplimiento?.faltantes ?? [];
    return faltantes.length ? faltantes.join(', ') : 'un requisito obligatorio';
  }

  // ── Interno ──────────────────────────────────────────────
  private cargar(): void {
    this.http.get<Flujo>('/api/submissions/workflow').subscribe({
      next: (flujo) => {
        this.flujo.set(flujo);
        // Una jornada sin cerrar se retoma donde quedó, no se empieza otra.
        if (flujo.jornadaAbierta) return this.retomarJornada();
        if (!flujo.canContinue) return;
        this.cargarDefinicion();
        this.cargarCuadrilla();
      },
      error: () => this.error.set('No fue posible validar tu estado. Revisa tu conexión.'),
    });
  }

  /** Candidatos elegibles y cargos; el oficial entra ya seleccionado. */
  private cargarCuadrilla(): void {
    this.http.get<Cargo[]>('/api/submissions/job-positions').subscribe({
      next: (cargos) => {
        this.cargos.set(cargos);
        this.http.get<{ candidates: Candidato[]; excluded: number }>('/api/submissions/crew-candidates').subscribe({
          next: (respuesta) => {
            this.candidatos.set(respuesta.candidates);
            this.excluidos.set(respuesta.excluded);
            const documento = this.flujo()?.collaborator.documentNumber;
            const yo = respuesta.candidates.find((persona) => persona.documentNumber === documento);
            if (!yo) return;
            this.yoId.set(yo.id);
            this.integrantes.set([{ candidato: yo, jobPositionId: this.cargoPorDefecto(yo), firmaDataUrl: null }]);
          },
          error: () => this.error.set('No fue posible cargar los colaboradores disponibles.'),
        });
      },
      error: () => this.error.set('No fue posible cargar los cargos.'),
    });
  }

  /** Salta al resultado para que el colaborador pueda cerrar lo que dejó abierto. */
  private retomarJornada(): void {
    this.http.get<Envio>('/api/submissions/mine/latest').subscribe({
      next: (resultado) => {
        this.envio.set(resultado);
        this.etapa.set('resultado');
      },
      error: () => this.error.set('No fue posible recuperar tu jornada en curso.'),
    });
  }

  private cargarDefinicion(): void {
    this.http.get<Definicion>('/api/forms/HSE-FO-016/current').subscribe({
      next: (definicion) => {
        for (const campo of definicion.schemaJson.fields) {
          // Un campo automático no se diligencia: lo completa el servidor.
          if (campo.type === 'auto') continue;
          this.respuestas.addControl(
            campo.id,
            new FormControl<unknown>(
              campo.type === 'multi_select' ? [] : '',
              campo.required ? Validators.required : [],
            ),
          );
        }
        this.definicion.set(definicion);
        this.restaurarBorrador();
      },
      error: () => this.error.set('No fue posible cargar el formato vigente.'),
    });
  }

  private faltaValor(campo: Campo): boolean {
    if (!this.debeMostrarCampo(campo.id)) return false;
    if (!campo.required || campo.type === 'auto') return false;
    const valor = this.valor(campo.id);
    if (Array.isArray(valor)) return valor.length === 0;
    return valor === null || valor === undefined || valor === '';
  }

  private descartarFaltante(id: string): void {
    if (this.faltantes().includes(id)) this.faltantes.update((lista) => lista.filter((otro) => otro !== id));
  }

  private enfocar(id: string): void {
    globalThis.setTimeout(() => {
      const elemento = document.querySelector<HTMLElement>(`[id="${id}-etiqueta"], [formcontrolname="${id}"]`);
      elemento?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }

  private respuestasNormalizadas(): Record<string, unknown> {
    const valores = this.respuestas.getRawValue();
    for (const campo of this.definicion()?.schemaJson.fields ?? []) {
      if (campo.type === 'number' && typeof valores[campo.id] === 'string') {
        valores[campo.id] = Number(valores[campo.id]);
      }
    }
    return valores;
  }

  /**
   * El lienzo es transparente y el PDF final va sobre papel blanco: sin este
   * fondo la firma se pierde al imprimir.
   */
  private firmaSobreBlanco(lienzo: HTMLCanvasElement): string {
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

  private sondearEstado(): void {
    clearInterval(this.sondeo);
    this.sondeo = setInterval(() => {
      if (this.envio()?.status === 'PENDING_APPROVAL') this.consultarEstado();
      else clearInterval(this.sondeo);
    }, 20_000);
  }

  // ── Borrador local ───────────────────────────────────────
  // Protege lo diligenciado si la aplicación se cierra a media jornada. No
  // sustituye a un borrador en servidor, que sigue siendo decisión pendiente.
  private guardarBorrador(): void {
    try {
      const documento = this.flujo()?.collaborator.documentNumber ?? '';
      localStorage.setItem(BORRADOR, JSON.stringify({ documento, valores: this.respuestas.getRawValue() }));
    } catch {
      // Modo privado o almacenamiento lleno: el flujo continúa sin borrador.
    }
  }

  private restaurarBorrador(): void {
    try {
      const crudo = localStorage.getItem(BORRADOR);
      if (!crudo) return;
      const guardado = JSON.parse(crudo) as { documento?: string; valores?: Record<string, unknown> };
      // El borrador de otro colaborador no debe aparecer en este dispositivo.
      if (guardado.documento !== this.flujo()?.collaborator.documentNumber) return this.borrarBorrador();
      for (const [id, valor] of Object.entries(guardado.valores ?? {})) this.respuestas.get(id)?.setValue(valor);
    } catch {
      this.borrarBorrador();
    }
  }

  private borrarBorrador(): void {
    try {
      localStorage.removeItem(BORRADOR);
    } catch {
      // Sin almacenamiento no hay nada que borrar.
    }
  }
}
