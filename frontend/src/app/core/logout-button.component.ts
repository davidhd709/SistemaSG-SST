import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthSessionService } from './auth-session.service';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'sg-logout-button',
  imports: [RouterLink],
  template: `
    @if (session.isAuthenticated()) {
      @if (session.kind() === 'ADMIN') {
        <a class="boton secundario compacto" routerLink="/administracion/mi-contrasena">Mi contraseña</a>
      }
      <button type="button" class="boton secundario compacto" (click)="session.logout()">Cerrar sesión</button>
    }
  `,
  styles: [
    `
      .compacto {
        min-height: 42px;
        padding: 8px 16px;
        font-size: 0.9375rem;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogoutButtonComponent {
  readonly session = inject(AuthSessionService);
}
