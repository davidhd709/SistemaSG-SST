import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { fechaCalendario } from '../../core/fechas';

export type Requisito = 'ARL' | 'SEGURIDAD_SOCIAL' | 'ALTURAS';

type Vencimiento = {
  requisito: Requisito;
  estado: 'VENCIDO' | 'POR_VENCER';
  cubiertoHasta: string | null;
  diasRestantes: number | null;
  detalle?: string;
  collaborator: {
    id: string;
    firstName: string;
    lastName: string;
    documentNumber: string;
    jobTitle: string | null;
    team: string | null;
  };
};

type Respuesta = { days: number; rows: Vencimiento[]; vencidos: number; porVencer: number };

const NOMBRES: Record<Requisito, string> = {
  ARL: 'ARL',
  SEGURIDAD_SOCIAL: 'Seguridad social',
  ALTURAS: 'Certificado de alturas',
};

/**
 * Vencimientos de la plantilla activa. Coordinación los ve con días de
 * anticipación para renovar la ARL, la planilla o el certificado antes de que
 * alguien quede fuera de su cuadrilla en plena obra.
 */
@Component({
  selector: 'sg-expirations-panel',
  template: `
    <section class="bloque" aria-labelledby="vencimientos-titulo">
      <div class="titulo-seccion">
        <h2 id="vencimientos-titulo">Requisitos por vencer</h2>
        <button class="boton secundario compacto" type="button" [disabled]="cargando()" (click)="cargar()">
          Actualizar
        </button>
      </div>
      <p class="secundario introduccion">
        Requisitos vencidos o que vencen pronto. Si la renovación ya está registrada y empieza al terminar la vigente,
        no aparece aquí.
      </p>

      <div class="rejilla-campos dos">
        <label class="campo">
          <span>Plazo de aviso</span>
          <select [value]="dias()" (change)="cambiarPlazo($any($event.target).value)">
            @for (opcion of plazos; track opcion) {
              <option [value]="opcion">Próximos {{ opcion }} días</option>
            }
          </select>
        </label>
        <label class="campo">
          <span>Requisito</span>
          <select [value]="filtro()" (change)="filtro.set($any($event.target).value)">
            <option value="">Todos</option>
            <option value="ARL">ARL</option>
            <option value="SEGURIDAD_SOCIAL">Seguridad social</option>
            <option value="ALTURAS">Certificado de alturas</option>
          </select>
        </label>
      </div>

      @if (error()) {
        <p class="mensaje error" role="alert">{{ error() }}</p>
      }

      @if (datos(); as resumen) {
        <section class="indicadores">
          <div class="indicador" [class.atencion]="resumen.vencidos > 0">
            <span class="cifra">{{ resumen.vencidos }}</span>
            <span class="rotulo">Vencidos hoy</span>
          </div>
          <div class="indicador">
            <span class="cifra">{{ resumen.porVencer }}</span>
            <span class="rotulo">Vencen en {{ resumen.days }} días</span>
          </div>
        </section>

        @if (filas().length) {
          <div class="tabla-scroll">
            <table class="datos">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Requisito</th>
                  <th>Cubierto hasta</th>
                  <th>Estado</th>
                  <th>Gestión</th>
                </tr>
              </thead>
              <tbody>
                @for (fila of filas(); track fila.collaborator.id + fila.requisito) {
                  <tr [class.fila-alerta]="fila.estado === 'VENCIDO'">
                    <td>
                      <strong>{{ fila.collaborator.firstName }} {{ fila.collaborator.lastName }}</strong>
                      <span class="secundario"
                        >{{ fila.collaborator.documentNumber }}
                        @if (fila.collaborator.jobTitle) {
                          · {{ fila.collaborator.jobTitle }}
                        }
                      </span>
                    </td>
                    <td>
                      {{ nombre(fila.requisito) }}
                      @if (fila.detalle) {
                        <span class="secundario">{{ fila.detalle }}</span>
                      }
                    </td>
                    <td>{{ fila.cubiertoHasta ? fecha(fila.cubiertoHasta) : 'Sin registro' }}</td>
                    <td>
                      <span class="distintivo" [class]="fila.estado === 'VENCIDO' ? 'vencida' : 'por-vencer'">{{
                        urgencia(fila)
                      }}</span>
                    </td>
                    <td>
                      @if (fila.requisito === 'ARL') {
                        <span class="secundario">La actualiza el Gestor de ARL</span>
                      } @else {
                        <button class="boton secundario compacto" type="button" (click)="renovar.emit(fila.requisito)">
                          Registrar renovación
                        </button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="vacio"><strong>Todo al día</strong>Nadie tiene requisitos vencidos ni por vencer en este plazo.</p>
        }
      } @else if (cargando()) {
        <p class="secundario">Consultando vencimientos…</p>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExpirationsPanelComponent {
  private readonly http = inject(HttpClient);

  /** Pide al contenedor abrir la sección donde se registra la renovación. */
  readonly renovar = output<Requisito>();

  readonly plazos = [7, 15, 30, 60];
  readonly dias = signal(15);
  readonly filtro = signal<Requisito | ''>('');
  readonly datos = signal<Respuesta | null>(null);
  readonly cargando = signal(false);
  readonly error = signal('');

  readonly filas = computed(() => {
    const filtro = this.filtro();
    const filas = this.datos()?.rows ?? [];
    return filtro ? filas.filter((fila) => fila.requisito === filtro) : filas;
  });

  constructor() {
    this.cargar();
  }

  cambiarPlazo(valor: string): void {
    this.dias.set(Number(valor));
    this.cargar();
  }

  cargar(): void {
    this.cargando.set(true);
    this.error.set('');
    this.http.get<Respuesta>('/api/compliance/expirations', { params: { days: this.dias() } }).subscribe({
      next: (respuesta) => {
        this.datos.set(respuesta);
        this.cargando.set(false);
      },
      error: () => {
        this.error.set('No fue posible consultar los vencimientos.');
        this.cargando.set(false);
      },
    });
  }

  nombre(requisito: Requisito): string {
    return NOMBRES[requisito];
  }

  fecha(valor: string): string {
    return fechaCalendario(valor);
  }

  urgencia(fila: Vencimiento): string {
    if (fila.estado === 'VENCIDO') return 'Vencido';
    if (fila.diasRestantes === 0) return 'Vence hoy';
    return `Vence en ${fila.diasRestantes} ${fila.diasRestantes === 1 ? 'día' : 'días'}`;
  }
}
