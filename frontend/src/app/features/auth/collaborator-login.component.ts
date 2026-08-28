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
    <div class="tarjeta">
      <div class="marca">
        <span class="sigla" aria-hidden="true">SST</span>
        <span class="nombre">
          Sistema SG-SST
          <span class="lema">Control previo al inicio de labores</span>
        </span>
      </div>

      <div class="encabezado">
        <span class="etiqueta-rol">Colaborador</span>
        <h1>Ingresa tus datos</h1>
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
          <span class="ayuda">Si olvidaste tu PIN, solicítalo a tu coordinadora.</span>
        </label>

        @if (error()) {
          <p class="mensaje error" role="alert">{{ error() }}</p>
        }

        <button class="boton bloque" [disabled]="form.invalid || loading()">
          {{ loading() ? 'Validando…' : 'Ingresar' }}
        </button>
      </form>

      <p class="pie-acceso">
        ¿Eres de Coordinación, ARL, Legal o Administración?
        <a routerLink="/administracion">Entra por el acceso interno</a>
      </p>
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
          void this.router.navigateByUrl('/formulario/alturas');
        },
        error: () => {
          this.error.set('Documento o PIN incorrecto. Verifica los datos e intenta de nuevo.');
          this.loading.set(false);
        },
      });
  }
}
