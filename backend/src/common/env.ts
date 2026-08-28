import type { ConfigService } from '@nestjs/config';

/**
 * `ConfigService.get<number>()` no convierte tipos: el genérico es solo un cast de
 * TypeScript y en tiempo de ejecución devuelve la cadena leída del entorno. Pasar esa
 * cadena a `jsonwebtoken` como `expiresIn` la interpreta en milisegundos y emite tokens
 * ya vencidos, así que toda lectura numérica del entorno pasa por aquí.
 */
export function getNumber(config: ConfigService, key: string, fallback: number): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`La variable de entorno ${key} debe ser numérica; se recibió "${String(raw)}".`);
  }
  return parsed;
}
