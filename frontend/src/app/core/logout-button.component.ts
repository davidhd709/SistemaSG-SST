import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AuthSessionService } from './auth-session.service';

@Component({
  selector: 'sg-logout-button',
  template: `
    @if (session.isAuthenticated()) {
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
