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
    <main class="portada">
      <section class="banda con-escudo" aria-labelledby="titulo">
        <div class="interior">
          <img
            class="logo"
            src="assets/marca/logo-completo-claro.png"
            alt="Gestión SST, sistema de formatos de salud y seguridad en el trabajo"
            width="720"
            height="243"
          />
          <h1 id="titulo">Tu jornada empieza aquí</h1>
          <p class="intro">Ingresa por el acceso que corresponde a tu tarea de hoy.</p>
        </div>
      </section>

      <div class="puertas">
        <a class="puerta destacada" routerLink="/ingreso">
          <span class="icono" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M2.5 18.5h19" />
              <path d="M4.5 18.5V16a7.5 7.5 0 0 1 15 0v2.5" />
              <path d="M9.5 9.2V6.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2.7" />
            </svg>
          </span>
          <span class="titulo">Voy a iniciar labores</span>
          <span class="detalle">Valida tu ARL, confirma la charla del día y completa tu permiso de trabajo.</span>
          <span class="pie">
            <span class="credencial">Documento y PIN</span>
            <svg class="flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </span>
        </a>

        <a class="puerta" routerLink="/administracion">
          <span class="icono" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <path d="M12 3 19 6v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <span class="titulo">Superviso o administro</span>
          <span class="detalle">Coordinación, ARL, Legal y Administración del sistema.</span>
          <span class="pie">
            <span class="credencial">Correo y contraseña</span>
            <svg class="flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </span>
        </a>
      </div>
    </main>
  `,
  styles: [
    `
      .portada {
        min-height: 100dvh;
        padding-bottom: 48px;
      }
      .banda {
        padding: clamp(32px, 6vw, 64px) 20px clamp(120px, 14vw, 150px);
        background: var(--banda-marina);
        color: #fff;
      }
      .banda.con-escudo::after {
        right: max(-60px, calc(50% - 620px));
        bottom: -60px;
        width: 460px;
        height: 468px;
      }
      .interior {
        width: min(100%, 920px);
        margin-inline: auto;
      }
      .logo {
        width: min(80%, 340px);
        margin-bottom: clamp(32px, 6vw, 56px);
      }
      h1 {
        max-width: 14ch;
        margin: 0 0 10px;
        color: #fff;
        font-size: clamp(2.25rem, 7vw, 3.75rem);
        font-weight: 800;
        letter-spacing: -0.035em;
        line-height: 1.04;
      }
      .intro {
        max-width: 44ch;
        margin: 0;
        color: #c3d3e3;
        font-size: 1.0625rem;
      }

      .puertas {
        display: grid;
        gap: 18px;
        width: min(100% - 32px, 920px);
        margin: clamp(-96px, -10vw, -72px) auto 0;
        animation: subir 700ms var(--curva) both;
      }
      @media (min-width: 680px) {
        .puertas {
          grid-template-columns: 1fr 1fr;
        }
      }

      .puerta {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 250px;
        padding: 26px 26px 22px;
        border: 1px solid var(--borde);
        border-radius: 22px;
        background: var(--superficie);
        box-shadow: var(--sombra-alta);
        color: var(--tinta);
        text-decoration: none;
        transition:
          transform 260ms var(--curva),
          box-shadow 260ms var(--curva);
      }
      .puerta:hover {
        color: var(--tinta);
        transform: translateY(-4px);
        box-shadow:
          0 4px 10px rgb(8 33 58 / 0.08),
          0 36px 64px -16px rgb(8 33 58 / 0.4);
      }
      .puerta.destacada {
        border-color: var(--azul-oscuro);
        background:
          radial-gradient(120% 90% at 100% 0%, rgb(95 208 184 / 0.28), transparent 60%),
          linear-gradient(160deg, #157a68, var(--azul) 55%, var(--azul-oscuro));
        color: #fff;
      }
      .puerta.destacada:hover {
        color: #fff;
      }
      .icono {
        display: grid;
        place-items: center;
        width: 52px;
        height: 52px;
        margin-bottom: 10px;
        border-radius: 15px;
        background: var(--fondo);
        box-shadow: inset 0 0 0 1px var(--borde);
        color: var(--marino);
      }
      .destacada .icono {
        background: rgb(255 255 255 / 0.14);
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.24);
        color: #fff;
      }
      .icono svg,
      .flecha {
        width: 26px;
        height: 26px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.9;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .titulo {
        font-family: var(--letra-marca);
        font-size: 1.375rem;
        font-weight: 700;
        letter-spacing: -0.02em;
      }
      .detalle {
        max-width: 38ch;
        color: var(--tinta-media);
        font-size: 0.9375rem;
        line-height: 1.5;
      }
      .pie {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-top: auto;
        padding-top: 16px;
      }
      .credencial {
        padding: 4px 11px;
        border-radius: 999px;
        background: var(--fondo);
        color: var(--tinta-media);
        font-family: var(--letra-marca);
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.03em;
      }
      .flecha {
        transition: transform 260ms var(--curva);
      }
      .puerta:hover .flecha {
        transform: translateX(4px);
      }
      .destacada .detalle {
        color: rgb(255 255 255 / 0.88);
      }
      .destacada .credencial {
        background: rgb(0 0 0 / 0.18);
        color: #e6f6f2;
      }
      @media (max-width: 679px) {
        .puerta {
          min-height: 0;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {}
