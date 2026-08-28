import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthSessionService } from './auth-session.service';

/**
 * Protege las rutas internas. Cuando la aplicación acaba de abrirse todavía no
 * se sabe si hay sesión, así que primero se espera al intento de restauración
 * desde la cookie; sin eso, recargar una pantalla interna rebotaría al acceso
 * aunque la sesión siguiera siendo válida.
 */
export function sesionRequerida(kind?: 'ADMIN' | 'COLLABORATOR'): CanActivateFn {
  return () => {
    const session = inject(AuthSessionService);
    const router = inject(Router);

    const decidir = (): boolean | ReturnType<Router['parseUrl']> => {
      if (!session.isAuthenticated()) {
        return router.parseUrl(kind === 'COLLABORATOR' ? '/ingreso' : '/administracion');
      }
      // Un colaborador no debe caer en las pantallas internas ni al revés.
      if (kind && session.kind() !== kind) {
        return router.parseUrl(session.kind() === 'COLLABORATOR' ? '/formulario/alturas' : '/administracion/panel');
      }
      return true;
    };

    return session.restaurando() ? session.renovar().pipe(map(decidir)) : decidir();
  };
}
