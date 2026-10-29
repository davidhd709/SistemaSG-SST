import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { SEDES, type Sede } from '../../core/sedes';

type Periodo = 'mes-actual' | 'mes-anterior' | 'ultimos-90' | 'anio' | 'personalizado';

/** Fecha AAAA-MM-DD del día calendario en Colombia, igual que `workDate`. */
function diaBogota(fecha: Date): string {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(fecha)
      .map((parte) => [parte.type, parte.value]),
  );
  return `${partes['year']}-${partes['month']}-${partes['day']}`;
}

function sumarDias(dia: string, dias: number): string {
  const fecha = new Date(`${dia}T00:00:00.000Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * Descarga el reporte de permisos en Excel: resumen, detalle de permisos,
 * rechazos y cumplimiento actual de la plantilla. Cada descarga queda en la
 * auditoría porque el archivo contiene datos personales.
 */
@Component({
  selector: 'sg-reports-panel',
  template: `
    <section class="bloque" aria-labelledby="reportes-titulo">
      <div class="titulo-seccion">
        <h2 id="reportes-titulo">Reporte de permisos en Excel</h2>
      </div>
      <p class="secundario introduccion">
        Incluye un resumen con indicadores, el detalle de cada permiso, los rechazos con su motivo y el cumplimiento
        actual de la plantilla. Las fechas corresponden al día de trabajo.
      </p>

      <div class="rejilla-campos dos">
        <label class="campo">
          <span>Periodo</span>
          <select [value]="periodo()" (change)="elegir($any($event.target).value)">
            <option value="mes-actual">Mes actual</option>
            <option value="mes-anterior">Mes anterior</option>
            <option value="ultimos-90">Últimos 90 días</option>
            <option value="anio">Año en curso</option>
            <option value="personalizado">Personalizado</option>
          </select>
        </label>
        <label class="campo">
          <span>Sede</span>
          <select [value]="sede()" (change)="sede.set($any($event.target).value)">
            <option value="">Todas las sedes</option>
            @for (opcion of sedes; track opcion.valor) {
              <option [value]="opcion.valor">{{ opcion.nombre }}</option>
            }
          </select>
        </label>
        <label class="campo">
          <span>Desde</span>
          <input type="date" [value]="desde()" (change)="ajustar('desde', $any($event.target).value)" />
        </label>
        <label class="campo">
          <span>Hasta</span>
          <input type="date" [value]="hasta()" (change)="ajustar('hasta', $any($event.target).value)" />
        </label>
      </div>

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }
      <div class="acciones">
        <button class="boton" type="button" [disabled]="descargando() || !desde() || !hasta()" (click)="descargar()">
          {{ descargando() ? 'Generando…' : 'Descargar Excel' }}
        </button>
      </div>
      <p class="secundario">El periodo admite hasta 366 días. La descarga queda registrada en la auditoría.</p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportsPanelComponent {
  private readonly http = inject(HttpClient);

  readonly periodo = signal<Periodo>('mes-actual');
  readonly desde = signal('');
  readonly hasta = signal('');
  readonly sede = signal<Sede | ''>('');
  readonly sedes = SEDES;
  readonly descargando = signal(false);
  readonly error = signal('');

  constructor() {
    this.elegir('mes-actual');
  }

  elegir(periodo: Periodo): void {
    this.periodo.set(periodo);
    if (periodo === 'personalizado') return;
    const hoy = diaBogota(new Date());
    const [anio, mes] = hoy.split('-').map(Number);
    if (periodo === 'mes-actual') {
      this.desde.set(`${hoy.slice(0, 7)}-01`);
      this.hasta.set(hoy);
    } else if (periodo === 'mes-anterior') {
      const inicio = new Date(Date.UTC(anio, mes - 2, 1));
      const fin = new Date(Date.UTC(anio, mes - 1, 0));
      this.desde.set(inicio.toISOString().slice(0, 10));
      this.hasta.set(fin.toISOString().slice(0, 10));
    } else if (periodo === 'ultimos-90') {
      this.desde.set(sumarDias(hoy, -89));
      this.hasta.set(hoy);
    } else {
      this.desde.set(`${anio}-01-01`);
      this.hasta.set(hoy);
    }
  }

  ajustar(extremo: 'desde' | 'hasta', valor: string): void {
    this.periodo.set('personalizado');
    (extremo === 'desde' ? this.desde : this.hasta).set(valor);
  }

  descargar(): void {
    if (this.descargando()) return;
    if (this.hasta() < this.desde()) {
      this.error.set('La fecha final no puede ser anterior a la inicial.');
      return;
    }
    this.descargando.set(true);
    this.error.set('');
    this.http
      .get('/api/reports/submissions.xlsx', {
        params: { from: this.desde(), to: this.hasta(), ...(this.sede() ? { site: this.sede() } : {}) },
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const enlace = document.createElement('a');
          enlace.href = url;
          const sufijo = this.sede() ? `-${this.sede().toLowerCase()}` : '';
          enlace.download = `reporte-permisos${sufijo}-${this.desde()}_${this.hasta()}.xlsx`;
          enlace.click();
          URL.revokeObjectURL(url);
          this.descargando.set(false);
        },
        error: (respuesta: HttpErrorResponse) => {
          this.descargando.set(false);
          void this.mensajeDeError(respuesta).then((mensaje) => this.error.set(mensaje));
        },
      });
  }

  /** Con `responseType: 'blob'` el error del servidor también llega como blob. */
  private async mensajeDeError(respuesta: HttpErrorResponse): Promise<string> {
    if (respuesta.status === 403) return 'No tienes permiso para exportar reportes.';
    try {
      const cuerpo = JSON.parse(await (respuesta.error as Blob).text()) as { message?: unknown };
      if (typeof cuerpo.message === 'string') return cuerpo.message;
    } catch {
      // Sin cuerpo legible se usa el mensaje general.
    }
    return 'No fue posible generar el reporte.';
  }
}
