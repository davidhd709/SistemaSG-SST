import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';
import { destinoPorRoles, type PerfilInterno } from '../../core/destino';

/**
 * Acceso interno, común a Coordinación, Gestor de ARL, Legal y Administración.
 * El destino tras autenticar depende de los roles efectivos de la cuenta.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  template: `<main class="pantalla">
    <div class="acceso">
      <aside class="panel-marca con-escudo">
        <img
          class="logo"
          src="assets/marca/logo-completo-claro.png"
          alt="Gestión SST, sistema de formatos de salud y seguridad en el trabajo"
          width="720"
          height="243"
        />
        <p class="titular">Cada permiso, trazable hasta su decisión</p>
        <ul>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="4" width="14" height="17" rx="2" />
              <path d="M9 4V3h6v1M9 12l2 2 4-4" />
            </svg>
            Revisión y autorización de permisos
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="9" cy="11" r="2" />
              <path d="M6 16c.6-1.4 1.7-2 3-2s2.4.6 3 2M15 10h3M15 13h3" />
            </svg>
            Afiliaciones ARL y seguridad social
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h10M4 12h8M4 18h10" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="16" cy="12" r="2" />
              <circle cx="18" cy="18" r="2" />
            </svg>
            Auditoría y consulta legal
          </li>
        </ul>
      </aside>

      <div class="tarjeta">
        <div class="encabezado">
          <h1>Acceso administrativo</h1>
          <p>Usa las credenciales asignadas por la organización.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" class="campos">
          <label class="campo">
            <span>Correo institucional</span>
            <input
              formControlName="email"
              autocomplete="username"
              type="email"
              enterkeyhint="next"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>

          <label class="campo">
            <span>Contraseña</span>
            <input formControlName="password" autocomplete="current-password" type="password" enterkeyhint="go" />
            <span class="ayuda">¿Olvidaste tu contraseña? El administrador del sistema puede restablecerla.</span>
          </label>

          @if (error()) {
            <p class="mensaje error" role="alert">{{ error() }}</p>
          }

          <button class="boton completo" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Ingresando…' : 'Ingresar' }}
          </button>
        </form>

        <ul class="roles">
          <li>Coordinación</li>
          <li>Gestor de ARL</li>
          <li>Legal</li>
          <li>Administración</li>
        </ul>

        <p class="pie-acceso">
          ¿Vas a iniciar labores?
          <a routerLink="/ingreso">Entra con tu documento y PIN</a>
        </p>
      </div>
    </div>
  </main>`,
  styles: [
    `
      .roles {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 20px 0 0;
        padding: 0;
        list-style: none;
      }
      .roles li {
        padding: 4px 11px;
        border-radius: 999px;
        background: var(--fondo);
        box-shadow: inset 0 0 0 1px var(--borde);
        color: var(--tinta-media);
        font-size: 0.8125rem;
        font-weight: 500;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLoginComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(12)]],
  });
  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    this.http
      .post<{ kind: 'ADMIN' | 'COLLABORATOR'; accessToken: string; expiresIn: number }>(
        '/api/auth/admin/login',
        this.form.getRawValue(),
        {
          withCredentials: true,
        },
      )
      .subscribe({
        next: (result) => {
          this.session.setSession(result.accessToken, 'ADMIN');
          const headers = new HttpHeaders({ Authorization: `Bearer ${result.accessToken}` });
          this.http.get<PerfilInterno>('/api/users/me', { headers }).subscribe({
            next: (profile) => {
              this.loading.set(false);
              // Una contraseña temporal (cuenta nueva o restablecida por
              // Administración) se reemplaza antes de trabajar.
              void this.router.navigateByUrl(
                profile.forcePasswordChange ? '/administracion/mi-contrasena' : destinoPorRoles(profile),
              );
            },
            error: () => {
              this.session.clear();
              this.error.set('No fue posible cargar los permisos de la cuenta.');
              this.loading.set(false);
            },
          });
        },
        error: () => {
          this.error.set('Correo o contraseña incorrectos. Verifica los datos e intenta de nuevo.');
          this.loading.set(false);
        },
      });
  }
}
