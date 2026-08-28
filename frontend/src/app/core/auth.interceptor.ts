import { inject } from '@angular/core';
import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest, HttpInterceptorFn } from '@angular/common/http';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthSessionService } from './auth-session.service';

/** Estas rutas gestionan la sesión: adjuntarles el token sobra o estorba. */
const RUTAS_DE_SESION = [
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/admin/login',
  '/api/auth/collaborator/login',
];

/**
 * Adjunta el access token a cada llamada a la API y, si el servidor responde
 * 401, renueva la sesión una sola vez y reintenta. Así una sesión caducada deja
 * de expulsar al usuario a mitad de trabajo.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(AuthSessionService);

  if (!request.url.startsWith('/api/') || RUTAS_DE_SESION.some((ruta) => request.url.startsWith(ruta))) {
    return next(request);
  }

  return next(conToken(request, session.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) return throwError(() => error);
      return reintentar(request, next, session);
    }),
  );
};

function reintentar(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  session: AuthSessionService,
): Observable<HttpEvent<unknown>> {
  return session.renovar().pipe(
    switchMap((token) => {
      if (!token) {
        // La cookie de refresco tampoco sirve: la sesión terminó de verdad.
        session.clear();
        session.irAlAcceso();
        return throwError(() => new HttpErrorResponse({ status: 401, statusText: 'Sesión expirada' }));
      }
      return next(conToken(request, token));
    }),
  );
}

function conToken(request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : request;
}
