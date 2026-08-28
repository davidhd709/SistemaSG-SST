import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';

type AdminProfile = { roles: { code: string }[] };

/**
 * Acceso interno, común a Coordinación, Gestor de ARL, Legal y Administración.
 * El destino tras autenticar depende de los roles efectivos de la cuenta.
 */
@Component({
  imports: [ReactiveFormsModule, RouterLink],
  template: `<main class="pantalla">
    <div class="tarjeta">
      <div class="marca">
        <span class="sigla" aria-hidden="true">SST</span>
        <span class="nombre">
          Sistema SG-SST
          <span class="lema">Control previo al inicio de labores</span>
        </span>
      </div>

      <div class="encabezado">
        <span class="etiqueta-rol">Equipo interno</span>
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
        </label>

        @if (error()) {
          <p class="mensaje error" role="alert">{{ error() }}</p>
        }

        <button class="boton bloque" [disabled]="form.invalid || loading()">
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
        padding: 4px 10px;
        border: 1px solid var(--borde);
        border-radius: 999px;
        background: var(--fondo);
        color: var(--tinta-media);
        font-size: 0.8125rem;
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
          this.http.get<AdminProfile>('/api/users/me', { headers }).subscribe({
            next: (profile) => {
              this.loading.set(false);
              void this.router.navigateByUrl(this.destination(profile));
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
  private destination(profile: AdminProfile): string {
    const roles = profile.roles.map((role) => role.code);
    if (roles.includes('ADMIN')) return '/administracion/panel';
    if (roles.includes('COORDINATOR')) return '/coordinacion';
    if (roles.includes('ARL_MANAGER')) return '/gestor-arl';
    if (roles.includes('LEGAL')) return '/legal';
    return '/';
  }
}
