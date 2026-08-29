import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthSessionService } from '../../core/auth-session.service';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { diasHasta, fechaCalendario, fechaHora } from '../../core/fechas';

type Resultado = {
  id: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  documentType: string;
  jobTitle: string | null;
  team: string | null;
  arlAffiliations: { providerName: string; startDate: string; endDate: string }[];
  submissions: { status: string; submittedAt: string | null; formVersion: { form: { code: string } } }[];
};

type Archivo = { id: string; originalName?: string; sha256: string };

type Afiliacion = {
  id: string;
  providerName: string;
  startDate: string;
  endDate: string;
  documents: { id: string; file: Archivo }[];
};

type Envio = {
  id: string;
  status: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  submittedAt: string | null;
  safetyTalkConfirmedAt: string | null;
  arlSnapshotJson: { providerName?: string; endDate?: string; status?: string };
  formVersion: { versionNumber: number; form: { code: string; name: string } };
  signature: { sha256: string; signedAt: string; file: Archivo } | null;
  approval: { decision: string; decidedAt: string; reason: string | null; decidedBy: { email: string } } | null;
  finalPdfFile: Archivo | null;
};

type Expediente = {
  id: string;
  firstName: string;
  lastName: string;
  documentType: string;
  documentNumber: string;
  jobTitle: string | null;
  team: string | null;
  status: string;
  createdAt: string;
  arlAffiliations: Afiliacion[];
  submissions: Envio[];
};

const ESTADOS: Record<string, string> = {
  DRAFT: 'Borrador',
  PENDING_APPROVAL: 'Pendiente de aprobación',
  APPROVED: 'Autorizado',
  REJECTED: 'Rechazado',
};

/**
 * Consulta de Legal. Es de solo lectura por definición del rol: aquí no se
 * modifica nada, se reconstruye qué ocurrió con un colaborador y se descargan
 * las evidencias que respaldan cada permiso.
 */
@Component({
  imports: [FormsModule, LogoutButtonComponent],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <span class="sigla" aria-hidden="true">SST</span>
          <span class="nombre">
            Consulta Legal
            <span class="lema">Cumplimiento y trazabilidad</span>
          </span>
        </div>
        <sg-logout-button />
      </div>
    </header>

    <main class="app-contenido">
      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }

      <section class="area-masthead" aria-labelledby="legal-titulo">
        <div>
          <h1 id="legal-titulo">Consulta legal</h1>
          <p>Consulta expedientes, permisos y soportes con trazabilidad de solo lectura.</p>
        </div>
        <span class="area-contexto">Solo lectura</span>
      </section>

      @if (expediente(); as ficha) {
        <!-- ══════════ Expediente ══════════ -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>{{ ficha.firstName }} {{ ficha.lastName }}</h2>
            <button class="boton secundario compacto" type="button" (click)="cerrar()">Volver a la búsqueda</button>
          </div>

          <dl class="ficha">
            <div>
              <dt>Documento</dt>
              <dd>{{ ficha.documentType }} {{ ficha.documentNumber }}</dd>
            </div>
            <div>
              <dt>Cargo</dt>
              <dd>{{ ficha.jobTitle || '—' }}</dd>
            </div>
            <div>
              <dt>Equipo</dt>
              <dd>{{ ficha.team || '—' }}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                <span class="distintivo" [class]="ficha.status === 'ACTIVE' ? 'vigente' : 'neutro'">
                  {{ ficha.status === 'ACTIVE' ? 'Activo' : 'Inactivo' }}
                </span>
              </dd>
            </div>
            <div>
              <dt>Registrado</dt>
              <dd>{{ momento(ficha.createdAt) }}</dd>
            </div>
          </dl>
        </section>

        <!-- ── Permisos diligenciados ── -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>
              Permisos diligenciados <span class="conteo">({{ ficha.submissions.length }})</span>
            </h2>
          </div>

          @if (ficha.submissions.length) {
            <div class="expedientes">
              @for (envio of ficha.submissions; track envio.id) {
                <article class="expediente" [class]="claseExpediente(envio.status)">
                  <div class="encabezado">
                    <div>
                      <strong>{{ envio.formVersion.form.name }}</strong>
                      <span class="secundario">
                        {{ envio.formVersion.form.code }} · versión {{ envio.formVersion.versionNumber }}
                      </span>
                    </div>
                    <span class="distintivo" [class]="claseEstado(envio.status)">{{ estado(envio.status) }}</span>
                  </div>

                  <dl class="datos-envio">
                    <div>
                      <dt>Enviado</dt>
                      <dd>{{ momento(envio.submittedAt) }}</dd>
                    </div>
                    <div>
                      <dt>Charla confirmada</dt>
                      <dd>{{ momento(envio.safetyTalkConfirmedAt) }}</dd>
                    </div>
                    <div>
                      <dt>ARL al momento del envío</dt>
                      <dd>
                        {{ envio.arlSnapshotJson.providerName || 'Sin afiliación' }}
                        @if (envio.arlSnapshotJson.endDate; as vence) {
                          <span class="secundario">vigente hasta {{ soloFecha(vence) }}</span>
                        }
                      </dd>
                    </div>
                    @if (envio.approval) {
                      <div>
                        <dt>Decidido por</dt>
                        <dd>
                          {{ envio.approval.decidedBy.email }}
                          <span class="secundario">{{ momento(envio.approval.decidedAt) }}</span>
                        </dd>
                      </div>
                    }
                  </dl>

                  @if (envio.approval; as decision) {
                    @if (decision.reason) {
                      <p class="motivo" [class.rechazo]="envio.status === 'REJECTED'">
                        <strong>{{ envio.status === 'REJECTED' ? 'Motivo del rechazo' : 'Observación' }}:</strong>
                        {{ decision.reason }}
                      </p>
                    }
                  }

                  <div class="evidencias">
                    @if (envio.finalPdfFile; as pdf) {
                      <div class="evidencia">
                        <button class="boton compacto" type="button" (click)="descargar(pdf.id, nombrePdf(envio))">
                          Descargar PDF final
                        </button>
                        <span class="huella">SHA-256 · {{ pdf.sha256 }}</span>
                      </div>
                    } @else {
                      <p class="secundario">Sin PDF final. Se genera cuando Coordinación decide.</p>
                    }

                    @if (envio.signature; as firma) {
                      <div class="evidencia">
                        <button
                          class="boton secundario compacto"
                          type="button"
                          (click)="descargar(firma.file.id, 'firma-' + envio.id + '.png')"
                        >
                          Descargar firma
                        </button>
                        <span class="huella">SHA-256 · {{ firma.sha256 }}</span>
                      </div>
                    }
                  </div>
                </article>
              }
            </div>
          } @else {
            <p class="secundario">Este colaborador no ha diligenciado permisos.</p>
          }
        </section>

        <!-- ── Afiliaciones ARL ── -->
        <section class="bloque">
          <div class="titulo-seccion">
            <h2>
              Historial de afiliaciones <span class="conteo">({{ ficha.arlAffiliations.length }})</span>
            </h2>
          </div>

          @if (ficha.arlAffiliations.length) {
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
                  @for (afiliacion of ficha.arlAffiliations; track afiliacion.id) {
                    <tr>
                      <td>{{ afiliacion.providerName }}</td>
                      <td>
                        {{ soloFecha(afiliacion.startDate) }}
                        <span class="secundario">hasta {{ soloFecha(afiliacion.endDate) }}</span>
                      </td>
                      <td>
                        <span class="distintivo" [class]="vigente(afiliacion.endDate) ? 'vigente' : 'vencida'">
                          {{ vigente(afiliacion.endDate) ? 'Vigente' : 'Vencida' }}
                        </span>
                      </td>
                      <td>
                        @if (afiliacion.documents.length) {
                          <div class="soportes">
                            @for (documento of afiliacion.documents; track documento.id; let i = $index) {
                              <button
                                class="boton secundario compacto"
                                type="button"
                                (click)="descargar(documento.file.id, documento.file.originalName || 'soporte-arl')"
                              >
                                {{ documento.file.originalName || 'Soporte ' + (i + 1) }}
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
            <p class="secundario">Sin afiliaciones registradas.</p>
          }
        </section>
      } @else {
        <!-- ══════════ Búsqueda ══════════ -->
        <div class="titulo-seccion">
          <h2>Buscar colaborador</h2>
        </div>
        <p class="secundario introduccion">
          Consulta de solo lectura. Desde aquí no se modifica ningún registro operativo.
        </p>

        <form class="buscador" (ngSubmit)="buscar()">
          <label class="campo">
            <span>Documento, nombre o apellido</span>
            <input [(ngModel)]="consulta" name="consulta" autocomplete="off" placeholder="Deja vacío para ver todos" />
          </label>
          <button class="boton" type="submit" [disabled]="buscando()">
            {{ buscando() ? 'Buscando…' : 'Buscar' }}
          </button>
        </form>

        @if (resultados().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>ARL más reciente</th>
                  <th>Último permiso</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (item of resultados(); track item.id) {
                  <tr>
                    <td>
                      <strong>{{ item.firstName }} {{ item.lastName }}</strong>
                      <span class="secundario">{{ item.documentType }} {{ item.documentNumber }}</span>
                    </td>
                    <td>
                      @if (item.arlAffiliations[0]; as arl) {
                        {{ arl.providerName }}
                        <span class="secundario">hasta {{ soloFecha(arl.endDate) }}</span>
                      } @else {
                        <span class="secundario">Sin afiliación</span>
                      }
                    </td>
                    <td>
                      @if (item.submissions[0]; as envio) {
                        <span class="distintivo" [class]="claseEstado(envio.status)">{{ estado(envio.status) }}</span>
                        <span class="secundario">{{ momento(envio.submittedAt) }}</span>
                      } @else {
                        <span class="secundario">Sin permisos</span>
                      }
                    </td>
                    <td>
                      <button class="boton compacto" type="button" (click)="abrir(item.id)">Ver expediente</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else if (busco()) {
          <p class="vacio">
            <strong>Sin resultados</strong>
            Prueba con otro documento o nombre.
          </p>
        }
      }
    </main>
  `,
  styles: [
    `
      .secundario {
        display: block;
        color: var(--tinta-suave);
        font-size: 0.875rem;
      }
      .introduccion {
        margin: -6px 0 20px;
      }

      .buscador {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 12px;
        margin-bottom: 24px;
      }
      .buscador .campo {
        flex: 1 1 320px;
      }

      .ficha {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px 24px;
        margin: 0;
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

      .expedientes {
        display: grid;
        gap: 14px;
      }
      .expediente {
        padding: 18px 20px;
        border: 1px solid var(--borde);
        border-left: 4px solid var(--borde-fuerte);
        border-radius: var(--radio);
        background: var(--fondo);
      }
      .expediente.autorizado {
        border-left-color: var(--ok);
      }
      .expediente.rechazado {
        border-left-color: var(--error);
      }
      .expediente.pendiente {
        border-left-color: var(--alerta);
      }
      .expediente .encabezado {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 14px;
      }

      .datos-envio {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 14px 20px;
        margin: 0 0 14px;
      }
      .datos-envio dt {
        color: var(--tinta-suave);
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }
      .datos-envio dd {
        margin: 2px 0 0;
        font-size: 0.9375rem;
      }

      .motivo {
        margin: 0 0 14px;
        padding: 10px 14px;
        border-radius: var(--radio);
        background: var(--superficie);
        border: 1px solid var(--borde);
        font-size: 0.9375rem;
      }
      .motivo.rechazo {
        background: var(--error-fondo);
        border-color: #eec6c2;
        color: var(--error);
      }

      .evidencias {
        display: grid;
        gap: 10px;
        padding-top: 14px;
        border-top: 1px solid var(--borde);
      }
      .evidencia {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .huella {
        color: var(--tinta-suave);
        font-size: 0.75rem;
        word-break: break-all;
      }
      .soportes {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
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
export class LegalSearchComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);

  consulta = '';
  readonly resultados = signal<Resultado[]>([]);
  readonly expediente = signal<Expediente | null>(null);
  readonly buscando = signal(false);
  readonly busco = signal(false);
  readonly error = signal('');

  constructor() {
    this.buscar();
  }

  buscar(): void {
    this.buscando.set(true);
    this.error.set('');
    this.http.get<Resultado[]>('/api/legal/collaborators', { params: { q: this.consulta } }).subscribe({
      next: (items) => {
        this.resultados.set(items);
        this.buscando.set(false);
        this.busco.set(true);
      },
      error: () => {
        this.error.set('No fue posible realizar la consulta o no tienes permiso.');
        this.buscando.set(false);
        this.busco.set(true);
      },
    });
  }

  abrir(collaboratorId: string): void {
    this.error.set('');
    this.http.get<Expediente>(`/api/legal/collaborators/${collaboratorId}/history`).subscribe({
      next: (ficha) => {
        this.expediente.set(ficha);
        globalThis.scrollTo({ top: 0 });
      },
      error: () => this.error.set('No fue posible abrir el expediente.'),
    });
  }

  cerrar(): void {
    this.expediente.set(null);
  }

  descargar(fileId: string, nombre: string): void {
    this.http.get(`/api/files/${fileId}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = nombre;
        enlace.click();
        URL.revokeObjectURL(url);
      },
      error: () => this.error.set('No fue posible descargar el documento.'),
    });
  }

  nombrePdf(envio: Envio): string {
    return `permiso-${envio.formVersion.form.code}-${envio.id}.pdf`;
  }

  estado(status: string): string {
    return ESTADOS[status] ?? status;
  }

  claseExpediente(status: string): string {
    if (status === 'APPROVED') return 'expediente autorizado';
    if (status === 'REJECTED') return 'expediente rechazado';
    if (status === 'PENDING_APPROVAL') return 'expediente pendiente';
    return 'expediente';
  }

  claseEstado(status: string): string {
    if (status === 'APPROVED') return 'vigente';
    if (status === 'REJECTED') return 'vencida';
    if (status === 'PENDING_APPROVAL') return 'por-vencer';
    return 'neutro';
  }

  /** Para Legal basta con si la vigencia cubría la fecha; el aviso de
   * renovación próxima es asunto del Gestor de ARL. */
  vigente(endDate: string): boolean {
    return diasHasta(endDate) >= 0;
  }

  soloFecha(valor: string): string {
    return fechaCalendario(valor);
  }

  momento(valor: string | null): string {
    return fechaHora(valor);
  }
}
