import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LogoutButtonComponent } from '../../core/logout-button.component';
import { FORMATOS } from './formatos';

/** Entrada del colaborador: elige el formato que va a diligenciar hoy. */
@Component({
  imports: [RouterLink, LogoutButtonComponent],
  template: `
    <header class="paso-cabecera">
      <div class="fila">
        <span class="identidad">
          <img src="assets/marca/marca-clara.png" alt="" width="36" height="36" />
          <span class="titulo">Formatos<span class="contador">¿Qué vas a diligenciar?</span></span>
        </span>
        <sg-logout-button />
      </div>
    </header>

    <main class="flujo">
      <h1 class="paso-titulo">Elige el formato</h1>
      <p class="paso-ayuda">Cada formato se envía por separado y Coordinación lo revisa antes de iniciar.</p>

      <nav class="formatos" aria-label="Formatos disponibles">
        @for (formato of formatos; track formato.codigo) {
          <a class="bloque formato" [routerLink]="['/formulario', formato.slug]">
            <span class="nombre">{{ formato.titulo }}</span>
            <span class="secundario">{{ formato.descripcion }}</span>
            <span class="codigo">{{ formato.codigo }}</span>
          </a>
        }
      </nav>

      <p class="centrado"><a routerLink="/mis-permisos">Ver mis formatos anteriores</a></p>
    </main>
  `,
  styles: [
    `
      .formatos {
        display: grid;
        gap: 12px;
      }
      .formato {
        display: grid;
        gap: 4px;
        color: inherit;
        text-decoration: none;
      }
      .formato .nombre {
        font-weight: 700;
        font-size: 1.05rem;
      }
      .formato .codigo {
        font-size: 0.8rem;
        letter-spacing: 0.04em;
        opacity: 0.7;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormPickerComponent {
  readonly formatos = FORMATOS;
}
