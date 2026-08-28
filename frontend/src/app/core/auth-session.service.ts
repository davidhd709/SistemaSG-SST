import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap } from 'rxjs';

export type SessionKind = 'ADMIN' | 'COLLABORATOR';

type RespuestaSesion = { kind: SessionKind; accessToken: string; expiresIn: number };

/**
 * Guarda la sesión de la PWA.
 *
 * El access token vive solo en memoria a propósito: guardarlo en
 * `localStorage` lo dejaría al alcance de cualquier XSS. La continuidad al
 * recargar la da el refresh token, que viaja en una cookie HttpOnly que el
 * JavaScript de la página no puede leer. Al arrancar, la aplicación cambia esa
 * cookie por un access token nuevo.
 */
@Injectable({ providedIn: 'root' })
export class AuthSessionService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly accessToken = signal<string | null>(null);
  readonly kind = signal<SessionKind | null>(null);
  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  /** Cierto mientras se intenta recuperar la sesión al abrir la aplicación. */
  readonly restaurando = signal(true);

  /** Renovación en curso, compartida para que varias peticiones no la dupliquen. */
  private renovacion$: Observable<string | null> | null = null;

  setSession(accessToken: string, kind: SessionKind): void {
    this.accessToken.set(accessToken);
    this.kind.set(kind);
  }

  clear(): void {
    this.accessToken.set(null);
    this.kind.set(null);
  }

  /** Se ejecuta una vez al arrancar, antes de resolver las rutas. */
  restaurar(): Observable<boolean> {
    return this.renovar().pipe(
      map((token) => token !== null),
      finalize(() => this.restaurando.set(false)),
    );
  }

  /**
   * Cambia la cookie de refresco por un access token nuevo. Las llamadas
   * simultáneas comparten la misma petición: si tres consultas caducan a la
   * vez, se renueva una sola vez y no tres, que además rotarían el token entre
   * sí y se invalidarían.
   */
  renovar(): Observable<string | null> {
    if (this.renovacion$) return this.renovacion$;
    this.renovacion$ = this.http.post<RespuestaSesion>('/api/auth/refresh', {}, { withCredentials: true }).pipe(
      map((resultado) => {
        this.setSession(resultado.accessToken, resultado.kind);
        return resultado.accessToken;
      }),
      catchError(() => {
        this.clear();
        return of(null);
      }),
      tap(() => (this.renovacion$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.renovacion$;
  }

  /**
   * Revoca la sesión en el servidor antes de olvidar el token local. Si la
   * llamada falla, la sesión local se limpia igualmente: el usuario pidió
   * salir y quedarse dentro por un error de red sería la peor respuesta.
   */
  logout(): void {
    const destino = this.kind() === 'COLLABORATOR' ? '/ingreso' : '/administracion';
    this.http.post('/api/auth/logout', {}, { withCredentials: true }).subscribe({
      next: () => this.terminar(destino),
      error: () => this.terminar(destino),
    });
  }

  /** Envía al acceso que corresponde cuando la sesión ya no es válida. */
  irAlAcceso(): void {
    void this.router.navigateByUrl(this.kind() === 'COLLABORATOR' ? '/ingreso' : '/administracion');
  }

  private terminar(destino: string): void {
    this.clear();
    void this.router.navigateByUrl(destino);
  }
}
