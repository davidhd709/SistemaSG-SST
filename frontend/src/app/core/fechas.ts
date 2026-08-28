/**
 * Formato de fechas del sistema.
 *
 * Hay dos clases de fecha y no se tratan igual:
 *
 * - **Día calendario**: la vigencia de una ARL (`@db.Date` en el modelo). El
 *   backend la entrega como medianoche UTC —`2026-01-01T00:00:00.000Z`— y la
 *   evalúa en UTC. Formatearla en la zona local de Colombia (UTC-5) la retrasa
 *   al día anterior, así que una afiliación registrada hasta el 31 de diciembre
 *   se leería como si venciera el 30.
 *
 * - **Instante**: el envío de un permiso o una decisión de coordinación. Ahí sí
 *   interesa la hora local de quien lo mira.
 */

const DIA_MS = 86_400_000;

/** Vigencias de ARL y cualquier otra fecha sin hora. Se lee en UTC. */
export function fechaCalendario(valor: string | null | undefined, mesLargo = false): string {
  if (!valor) return '—';
  return new Date(valor).toLocaleDateString('es-CO', {
    day: '2-digit',
    month: mesLargo ? 'long' : 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Sellos de tiempo reales: envíos, decisiones, cargas. Se leen en local. */
export function fechaHora(valor: string | null | undefined): string {
  if (!valor) return '—';
  return new Date(valor).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Días calendario que faltan para una fecha, contados en UTC igual que el
 * cálculo de vigencia del backend, para que ambos coincidan siempre.
 */
export function diasHasta(valor: string): number {
  const ahora = new Date();
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const objetivo = new Date(valor);
  const fin = Date.UTC(objetivo.getUTCFullYear(), objetivo.getUTCMonth(), objetivo.getUTCDate());
  return Math.round((fin - hoy) / DIA_MS);
}

/** Texto de urgencia para el Gestor de ARL: prioriza por días, no por fecha. */
export function textoVencimiento(valor: string): string {
  const dias = diasHasta(valor);
  if (dias < 0) return `Venció hace ${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'día' : 'días'}`;
  if (dias === 0) return 'Vence hoy';
  return `Faltan ${dias} ${dias === 1 ? 'día' : 'días'}`;
}
