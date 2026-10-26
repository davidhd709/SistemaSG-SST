import type { Cumplimiento } from '../compliance/compliance.service';

/**
 * Lo que cambia entre un formato oficial y otro al diligenciarlo. El esquema
 * dice qué se pregunta; el perfil dice cómo se recorre el flujo: si hay charla,
 * cuántas personas caben en el documento, si existe jornada y qué firmas exige.
 */
export type PerfilFormato = {
  code: string;
  /** Ruta de la app donde el colaborador diligencia el formato. */
  ruta: string;
  /** Filas de integrantes que imprime la plantilla oficial. */
  maxIntegrantes: number;
  /** Exige ver la charla de seguridad antes de enviar. */
  charla: boolean;
  /** El certificado de alturas cuenta como requisito para este formato. */
  certificadoAlturas: boolean;
  /** Tiene inicio y cierre de jornada; si no, la aprobación lo deja archivado. */
  jornada: boolean;
  /** Cada integrante vuelve a firmar al cerrar la jornada (firma de término). */
  firmaCierre: boolean;
  /** La aprobación estampa el nombre y la firma registrados de Coordinación. */
  firmaCoordinacion: boolean;
  /** Texto que identifica en el documento al oficial que diligencia. */
  marcaLider?: string;
};

export const PERFILES_FORMATO: Readonly<Record<string, PerfilFormato>> = {
  'HSE-FO-016': {
    code: 'HSE-FO-016',
    ruta: '/formulario/alturas',
    maxIntegrantes: 5,
    charla: true,
    certificadoAlturas: true,
    jornada: true,
    firmaCierre: false,
    firmaCoordinacion: false,
  },
  'HSE-FO-018': {
    code: 'HSE-FO-018',
    ruta: '/formulario/ats',
    maxIntegrantes: 12,
    charla: false,
    certificadoAlturas: false,
    jornada: true,
    firmaCierre: false,
    firmaCoordinacion: true,
  },
  'FORSG-03': {
    code: 'FORSG-03',
    ruta: '/formulario/electrico',
    maxIntegrantes: 10,
    charla: false,
    certificadoAlturas: false,
    jornada: true,
    firmaCierre: true,
    firmaCoordinacion: true,
    // El formato pide marcar con (*) al supervisor que permanece en la labor.
    marcaLider: ' (*)',
  },
  'HSE-FO-023': {
    code: 'HSE-FO-023',
    ruta: '/formulario/escalera',
    maxIntegrantes: 1,
    charla: false,
    certificadoAlturas: false,
    jornada: false,
    firmaCierre: false,
    firmaCoordinacion: false,
  },
};

/** Mayor cuadrilla que admite cualquier formato: límite del DTO de envío. */
export const MAX_INTEGRANTES_FORMATO = Math.max(...Object.values(PERFILES_FORMATO).map((p) => p.maxIntegrantes));

export function perfilFormato(code: string): PerfilFormato | undefined {
  return Object.prototype.hasOwnProperty.call(PERFILES_FORMATO, code) ? PERFILES_FORMATO[code] : undefined;
}

/**
 * Requisitos que pesan para este formato. El certificado de alturas solo
 * bloquea donde se trabaja en alturas; ARL y seguridad social, siempre.
 */
export function faltantesPara(cumplimiento: Cumplimiento | undefined, perfil: PerfilFormato): string[] {
  if (!cumplimiento) return ['ARL', 'Seguridad social'];
  const faltantes = cumplimiento.faltantes ?? (cumplimiento.apto ? [] : ['Requisitos']);
  return perfil.certificadoAlturas ? faltantes : faltantes.filter((faltante) => faltante !== 'Certificado de alturas');
}

export function aptoPara(cumplimiento: Cumplimiento | undefined, perfil: PerfilFormato): boolean {
  return faltantesPara(cumplimiento, perfil).length === 0;
}
