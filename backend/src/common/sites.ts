import type { Site } from '@prisma/client';

/**
 * Sedes de la operación. Comparten administración, coordinación, legal y
 * gestión ARL; lo que cambia es cómo se da la charla de seguridad.
 */
export type Sede = {
  code: Site;
  nombre: string;
  /** En video dentro de la app; si no, se dicta en persona y el oficial lo declara. */
  charlaEnVideo: boolean;
};

export const SEDES: Readonly<Record<Site, Sede>> = {
  ALCALA: { code: 'ALCALA', nombre: 'Alcalá', charlaEnVideo: true },
  MONTELIBANO: { code: 'MONTELIBANO', nombre: 'Montelíbano', charlaEnVideo: false },
};

export const SITE_CODES = Object.keys(SEDES) as Site[];
