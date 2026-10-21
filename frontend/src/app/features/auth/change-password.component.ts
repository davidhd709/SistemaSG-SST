import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="contenedor" style="max-width: 560px; padding-block: 48px">
      <a routerLink="/administracion/panel">Volver al panel</a>
      <section class="bloque">
        <h1>Cambiar mi contraseña</h1>
        <p class="secundario">Después del cambio se cerrarán tus sesiones. Ingresa de nuevo con la contraseña nueva.</p>
        <form [formGroup]="form" (ngSubmit)="guardar()">
          <label class="campo"
            ><span>Contraseña actual</span
            ><input type="password" formControlName="currentPassword" autocomplete="current-password"
          /></label>
          <label class="campo"
            ><span>Nueva contraseña</span
            ><input type="password" formControlName="newPassword" autocomplete="new-password"
          /></label>
          <label class="campo"
            ><span>Repetir nueva contraseña</span
            ><input type="password" formControlName="confirmPassword" autocomplete="new-password"
          /></label>
          @if (error()) {
            <p class="mensaje alerta" role="alert">{{ error() }}</p>
          }
          <button class="boton" type="submit" [disabled]="form.invalid || saving()">
            {{ saving() ? 'Guardando…' : 'Cambiar contraseña' }}
          </button>
        </form>
      </section>
    </main>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePasswordComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
    confirmPassword: ['', Validators.required],
  });

  guardar(): void {
    if (this.form.invalid || this.saving()) return;
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (newPassword !== confirmPassword) {
      this.error.set('Las contraseñas nuevas no coinciden.');
      return;
    }
    this.error.set('');
    this.saving.set(true);
    this.http.patch('/api/users/me/password', { currentPassword, newPassword }).subscribe({
      next: () => this.session.logout(),
      error: () => {
        this.saving.set(false);
        this.error.set('No se pudo cambiar la contraseña. Revisa la contraseña actual e inténtalo de nuevo.');
      },
    });
  }
}
