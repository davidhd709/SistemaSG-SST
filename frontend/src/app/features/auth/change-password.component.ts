import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../../core/auth-session.service';
import { destinoPorRoles, type PerfilInterno } from '../../core/destino';
import { LogoutButtonComponent } from '../../core/logout-button.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, LogoutButtonComponent],
  template: `
    <header class="app-cabecera">
      <div class="fila">
        <div class="marca">
          <img class="sigla" src="assets/marca/marca-clara.png" alt="" width="40" height="40" /><span class="sello"
            >Gestión SST</span
          >
          <span class="nombre">Mi cuenta<span class="lema">Seguridad de acceso</span></span>
        </div>
        @if (temporal()) {
          <sg-logout-button />
        } @else {
          <a class="boton secundario compacto" [routerLink]="volver()">Volver a mi área</a>
        }
      </div>
    </header>
    <main class="app-contenido">
      <section class="area-masthead" aria-labelledby="clave-titulo">
        <div>
          <h1 id="clave-titulo">Cambiar mi contraseña</h1>
          <p>Después del cambio se cerrarán tus sesiones. Ingresa de nuevo con la contraseña nueva.</p>
        </div>
      </section>
      @if (temporal()) {
        <p class="mensaje alerta cambio" role="status">
          Estás usando una contraseña temporal asignada por el administrador. Cámbiala para continuar.
        </p>
      }
      <section class="bloque cambio">
        <form [formGroup]="form" (ngSubmit)="guardar()" class="campos">
          <label class="campo"
            ><span>{{ temporal() ? 'Contraseña temporal' : 'Contraseña actual' }}</span
            ><input type="password" formControlName="currentPassword" autocomplete="current-password"
          /></label>
          <label class="campo"
            ><span>Nueva contraseña</span
            ><input type="password" formControlName="newPassword" autocomplete="new-password" /><span class="ayuda"
              >Mínimo 12 caracteres.</span
            ></label
          >
          <label class="campo"
            ><span>Repetir nueva contraseña</span
            ><input type="password" formControlName="confirmPassword" autocomplete="new-password"
          /></label>
          @if (error()) {
            <p class="mensaje alerta" role="alert">{{ error() }}</p>
          }
          <div class="acciones">
            <button class="boton" type="submit" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Guardando…' : 'Cambiar contraseña' }}
            </button>
          </div>
        </form>
      </section>
    </main>
  `,
  styles: [
    `
      .cambio {
        max-width: 560px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangePasswordComponent {
  private readonly http = inject(HttpClient);
  private readonly session = inject(AuthSessionService);
  private readonly fb = inject(FormBuilder);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly temporal = signal(false);
  readonly volver = signal('/');
  readonly form = this.fb.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
    confirmPassword: ['', Validators.required],
  });

  constructor() {
    this.http.get<PerfilInterno>('/api/users/me').subscribe({
      next: (perfil) => {
        this.temporal.set(!!perfil.forcePasswordChange);
        this.volver.set(destinoPorRoles(perfil));
      },
    });
  }

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
