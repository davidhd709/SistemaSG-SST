import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { fechaCalendario } from '../../core/fechas';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { rutaFormato } from './formatos';

type EstadoPermiso = 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED' | 'REJECTED' | 'EXPIRED';

type Permiso = {
  id: string;
  status: EstadoPermiso;
  isLead: boolean;
  workDate: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  previousSubmissionId: string | null;
  correctedById: string | null;
  correctable: boolean;
  finalPdfFileId: string | null;
  approval: { decision: string; decidedAt: string; reason: string | null } | null;
  form: { code: string; name: string; version: number };
  members: {
    isLead: boolean;
    collaborator: { firstName: string; lastName: string };
    jobPosition: { name: string } | null;
  }[];
};

type Pagina = { items: Permiso[]; page: number; totalPages: number; total: number };

/**
 * Historial del colaborador. Reúne los permisos en los que participó para que
 * pueda consultar su estado, descargar el documento final y corregir un
 * permiso rechazado sin diligenciarlo de nuevo desde cero.
 */
@Component({
  imports: [RouterLink, LogoutButtonComponent],
  template: `
    <header class="paso-cabecera">
      <div class="fila">
        <span class="identidad">
          <img src="assets/marca/marca-clara.png" alt="" width="36" height="36" />
          <span class="titulo">Mis permisos<span class="contador">Historial de jornadas</span></span>
        </span>
        <sg-logout-button />
      </div>
    </header>

    <main class="flujo">
      <div class="acciones">
        <a class="boton secundario compacto" routerLink="/formatos">Volver a los formatos</a>
      </div>

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }

      @if (cargando() && !permisos().length) {
        <p class="paso-ayuda">Consultando tus permisos…</p>
      } @else if (!permisos().length && !error()) {
        <p class="vacio"><strong>Aún no tienes permisos</strong>Cuando envíes tu primer permiso aparecerá aquí.</p>
      }

      @for (permiso of permisos(); track permiso.id) {
        <article class="bloque permiso">
          <div class="titulo-seccion">
            <h2>{{ fecha(permiso.workDate || permiso.submittedAt) }}</h2>
            <span class="distintivo" [class]="claseEstado(permiso.status)">{{ textoEstado(permiso.status) }}</span>
          </div>
          <p class="secundario">
            {{ permiso.form.name }} · {{ permiso.isLead ? 'Lo diligenciaste tú' : 'Participaste como integrante' }}
          </p>
          @if (permiso.startedAt) {
            <p class="secundario">Jornada: {{ hora(permiso.startedAt) }} a {{ hora(permiso.closedAt) }}</p>
          }
          <p class="secundario">Cuadrilla: {{ cuadrilla(permiso) }}</p>

          @if (permiso.status === 'REJECTED' && permiso.approval?.reason) {
            <p class="mensaje alerta">Motivo del rechazo: {{ permiso.approval?.reason }}</p>
          }
          @if (permiso.previousSubmissionId) {
            <p class="secundario">Corrige un permiso rechazado anteriormente.</p>
          }
          @if (permiso.correctedById) {
            <p class="secundario">Ya fue corregido y reenviado.</p>
          }

          <div class="acciones">
            @if (permiso.correctable) {
              <a class="boton compacto" [routerLink]="ruta(permiso)" [queryParams]="{ corregir: permiso.id }">
                Corregir y reenviar
              </a>
            }
            @if (permiso.finalPdfFileId) {
              <button
                class="boton secundario compacto"
                type="button"
                [disabled]="descargando() === permiso.id"
                (click)="descargar(permiso)"
              >
                {{ descargando() === permiso.id ? 'Descargando…' : 'Descargar PDF' }}
              </button>
            }
          </div>
        </article>
      }

      @if (pagina() < totalPaginas()) {
        <div class="acciones centrado">
          <button class="boton secundario" type="button" [disabled]="cargando()" (click)="cargar(pagina() + 1)">
            {{ cargando() ? 'Cargando…' : 'Ver permisos anteriores' }}
          </button>
        </div>
      }
    </main>
  `,
  styles: [
    `
      .permiso p {
        margin: 6px 0;
      }
      .permiso .acciones {
        margin-top: 14px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyPermitsComponent {
  private readonly http = inject(HttpClient);

  readonly permisos = signal<Permiso[]>([]);
  readonly pagina = signal(0);
  readonly totalPaginas = signal(0);
  readonly cargando = signal(false);
  readonly descargando = signal<string | null>(null);
  readonly error = signal('');

  constructor() {
    this.cargar(1);
  }

  cargar(pagina: number): void {
    if (this.cargando()) return;
    this.cargando.set(true);
    this.error.set('');
    this.http.get<Pagina>('/api/submissions/mine', { params: { page: pagina, pageSize: 20 } }).subscribe({
      next: (respuesta) => {
        // Las páginas siguientes se agregan debajo: en el celular se recorre hacia abajo.
        this.permisos.update((actuales) => (pagina === 1 ? respuesta.items : [...actuales, ...respuesta.items]));
        this.pagina.set(respuesta.page);
        this.totalPaginas.set(respuesta.totalPages);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No fue posible consultar tus permisos. Revisa tu conexión.');
        this.cargando.set(false);
      },
    });
  }

  descargar(permiso: Permiso): void {
    if (!permiso.finalPdfFileId || this.descargando()) return;
    this.descargando.set(permiso.id);
    this.http.get(`/api/files/${permiso.finalPdfFileId}/download`, { responseType: 'blob' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const enlace = document.createElement('a');
        enlace.href = url;
        enlace.download = `${permiso.form.code}-${(permiso.workDate || permiso.submittedAt || '').slice(0, 10)}.pdf`;
        enlace.click();
        URL.revokeObjectURL(url);
        this.descargando.set(null);
      },
      error: () => {
        this.error.set('No fue posible descargar el documento.');
        this.descargando.set(null);
      },
    });
  }

  ruta(permiso: Permiso): string {
    return rutaFormato(permiso.form.code);
  }

  cuadrilla(permiso: Permiso): string {
    return permiso.members
      .map((integrante) => `${integrante.collaborator.firstName} ${integrante.collaborator.lastName}`)
      .join(', ');
  }

  fecha(valor: string | null): string {
    return fechaCalendario(valor, true);
  }

  hora(valor: string | null): string {
    if (!valor) return '—';
    return new Date(valor).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Bogota',
    });
  }

  textoEstado(estado: EstadoPermiso): string {
    return {
      PENDING_APPROVAL: 'Pendiente de autorización',
      APPROVED: 'Autorizado',
      CLOSED: 'Cerrado',
      REJECTED: 'Rechazado',
      EXPIRED: 'Vencido',
    }[estado];
  }

  claseEstado(estado: EstadoPermiso): string {
    if (estado === 'CLOSED' || estado === 'APPROVED') return 'vigente';
    if (estado === 'PENDING_APPROVAL') return 'por-vencer';
    if (estado === 'REJECTED') return 'vencida';
    return 'neutro';
  }
}
