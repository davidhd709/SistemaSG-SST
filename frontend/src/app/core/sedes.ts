/**
 * Sedes de la operación. Comparten administración, coordinación, legal y
 * gestión ARL; en Alcalá la charla de seguridad se ve en video y en
 * Montelíbano se dicta en persona.
 */
export type Sede = 'ALCALA' | 'MONTELIBANO';

export const SEDES: readonly { valor: Sede; nombre: string }[] = [
  { valor: 'ALCALA', nombre: 'Alcalá' },
  { valor: 'MONTELIBANO', nombre: 'Montelíbano' },
];

export function nombreSede(sede: Sede | null | undefined): string {
  return SEDES.find((opcion) => opcion.valor === sede)?.nombre ?? '';
}
