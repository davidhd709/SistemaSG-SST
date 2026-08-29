import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Bifurcación de acceso. El sistema tiene dos poblaciones con necesidades
 * distintas: el colaborador entra desde su celular con documento y PIN, y el
 * equipo interno entra con credenciales corporativas. Se presentan como dos
 * puertas separadas para que nadie tenga que averiguar cuál le corresponde.
 */
@Component({
  selector: 'sg-home',
  imports: [RouterLink],
  template: `
    <main class="pantalla">
      <div class="contenido">
        <div class="marca">
          <span class="sigla" aria-hidden="true">SST</span>
          <span class="nombre">
            Sistema SG-SST
            <span class="lema">Control previo al inicio de labores</span>
          </span>
        </div>

        <h1 id="titulo">Tu jornada empieza aquí</h1>
        <p class="intro">Ingresa por el acceso que corresponde a tu tarea de hoy.</p>

        <div class="puertas">
          <a class="puerta destacada" routerLink="/ingreso">
            <span class="titulo">Voy a iniciar labores</span>
            <span class="detalle">Valida tu ARL, confirma la charla del día y completa tu permiso de trabajo.</span>
            <span class="credencial">Documento y PIN</span>
            <span class="flecha" aria-hidden="true">→</span>
          </a>

          <a class="puerta" routerLink="/administracion">
            <span class="titulo">Superviso o administro</span>
            <span class="detalle">Coordinación, ARL, Legal y Administración del sistema.</span>
            <span class="credencial">Correo y contraseña</span>
            <span class="flecha" aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </main>
  `,
  styles: [
    `
      .contenido {
        width: min(100%, 860px);
      }
      h1 {
        max-width: 13ch;
        margin: 0 0 8px;
        font-size: clamp(2rem, 7vw, 3.5rem);
        letter-spacing: -0.035em;
      }
      .intro {
        max-width: 44ch;
        margin: 0 0 32px;
        color: var(--tinta-media);
      }
      .puertas {
        display: grid;
        gap: 18px;
      }
      @media (min-width: 680px) {
        .puertas {
          grid-template-columns: 1fr 1fr;
        }
      }

      .puerta {
        display: grid;
        gap: 6px;
        position: relative;
        min-height: 230px;
        padding: 28px 56px 26px 26px;
        background: var(--superficie);
        border: 0;
        border-radius: var(--radio-grande);
        box-shadow: var(--sombra);
        color: var(--tinta);
        text-decoration: none;
        transition:
          transform 180ms ease,
          box-shadow 180ms ease,
          background-color 180ms ease;
      }
      .puerta:hover {
        background: #f8fdf9;
        box-shadow: var(--sombra-alta);
        transform: translateY(-3px);
      }
      .puerta.destacada {
        background: var(--azul);
        color: #fff;
        box-shadow: 0 14px 30px rgb(21 93 74 / 0.2);
      }
      .puerta .titulo {
        font-size: 1.35rem;
        font-weight: 700;
        letter-spacing: -0.01em;
      }
      .detalle {
        color: var(--tinta-media);
        font-size: 0.9375rem;
        line-height: 1.5;
      }
      .credencial {
        margin-top: auto;
        font-size: 0.8125rem;
        color: var(--tinta-suave);
        font-weight: 650;
      }
      .flecha {
        position: absolute;
        top: 24px;
        right: 22px;
        font-size: 1.5rem;
        color: currentColor;
      }
      .puerta.destacada .detalle,
      .puerta.destacada .credencial {
        color: rgb(255 255 255 / 0.84);
      }
      @media (max-width: 679px) {
        .puerta {
          min-height: 205px;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {}
