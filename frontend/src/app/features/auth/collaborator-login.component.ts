import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';

/**
 * Acceso operativo. Se usa de pie, en obra y con poca luz, así que los campos
 * son grandes, abren teclado numérico y la pantalla tiene una sola tarea.
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
        <p class="titular">Control previo al inicio de labores</p>
        <ul>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3 19 6v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Validamos tu afiliación ARL
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="3" />
              <path d="m10 9 5 3-5 3V9Z" />
            </svg>
            Confirmas la charla de seguridad del día
          </li>
          <li>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h16" />
              <path d="M14.5 4.5a2.1 2.1 0 0 1 3 3L8 17l-4 1 1-4 9.5-9.5Z" />
            </svg>
            Firmas tu permiso de trabajo
          </li>
        </ul>
      </aside>

      <div class="tarjeta">
        <div class="encabezado">
          <h1>Ingreso de colaboradores</h1>
          <p>Usa tu número de documento y el PIN que te asignaron.</p>
        </div>

        <form [formGroup]="form" (ngSubmit)="submit()" class="campos">
          <label class="campo">
            <span>Número de documento</span>
            <input
              class="numerico"
              formControlName="documentNumber"
              autocomplete="username"
              inputmode="numeric"
              enterkeyhint="next"
              autocapitalize="off"
              spellcheck="false"
            />
          </label>

          <label class="campo">
            <span>PIN personal</span>
            <input
              class="numerico"
              type="password"
              formControlName="pin"
              autocomplete="current-password"
              inputmode="numeric"
              enterkeyhint="go"
            />
            <span class="ayuda">¿Olvidaste tu PIN? El administrador del sistema puede restablecerlo.</span>
          </label>

          @if (error()) {
            <p class="mensaje error" role="alert">{{ error() }}</p>
          }

          <button class="boton completo" [disabled]="form.invalid || loading()">
            {{ loading() ? 'Validando…' : 'Ingresar' }}
          </button>
        </form>

        <p class="pie-acceso">
          ¿Eres de Coordinación, ARL, Legal o Administración?
          <a routerLink="/administracion">Entra por el acceso interno</a>
        </p>
      </div>
    </div>
  </main>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CollaboratorLoginComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    documentNumber: ['', [Validators.required, Validators.minLength(5)]],
    pin: ['', [Validators.required, Validators.minLength(4)]],
  });
  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true);
    this.error.set('');
    this.http
      .post<{ kind: 'ADMIN' | 'COLLABORATOR'; accessToken: string; expiresIn: number }>(
        '/api/auth/collaborator/login',
        this.form.getRawValue(),
      )
      .subscribe({
        next: (result) => {
          this.session.setSession(result.accessToken, 'COLLABORATOR');
          this.loading.set(false);
          void this.router.navigateByUrl('/formatos');
        },
        error: () => {
          this.error.set('Documento o PIN incorrecto. Verifica los datos e intenta de nuevo.');
          this.loading.set(false);
        },
      });
  }
}
