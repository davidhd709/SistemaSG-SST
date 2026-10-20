import type { Express } from 'express';

/** Solo confía en los saltos de proxy conocidos delante de la API. */
export function configureTrustedProxy(app: Express, hops: number): void {
  if (!Number.isInteger(hops) || hops < 0 || hops > 2) {
    throw new Error('TRUST_PROXY_HOPS debe ser 0, 1 o 2.');
  }
  app.set('trust proxy', hops);
}
