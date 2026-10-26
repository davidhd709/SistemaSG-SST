export const EDITABLE_FIELD_TYPES = new Set(['text', 'textarea', 'yes_no', 'select', 'multi_select', 'number', 'date']);

export type AutoFieldSource = 'workDate' | 'startedAt' | 'closedAt' | 'heightCertificate' | 'socialSecurity';

export const AUTO_FIELD_SOURCES: ReadonlySet<AutoFieldSource> = new Set([
  'workDate',
  'startedAt',
  'closedAt',
  'heightCertificate',
  'socialSecurity',
]);

export function isAutoFieldSource(value: unknown): value is AutoFieldSource {
  return typeof value === 'string' && AUTO_FIELD_SOURCES.has(value as AutoFieldSource);
}

export const RESERVED_AUTOMATIC_FIELD_IDS = new Set([
  'vigencia_permiso',
  'fecha_trabajo',
  'hora_inicio',
  'hora_finalizacion',
  'hora_fin',
  'certificado_alturas',
  'seguridad_social_verificada',
]);

const RESERVED_SIGNATURE_FIELD_IDS = new Set([
  'autorizador_firma',
  'firma_autorizador',
  'responsable_emergencia_firma',
  'firma_responsable_emergencia',
  'coordinador_alturas_firma',
  'firma_coordinador_alturas',
]);

const RESERVED_IDENTITY_FIELD_IDS = new Set(['cedula', 'documento', 'nombre', 'cargo']);
const RESERVED_CREW_ROW_PATTERN = /^(cuadrilla|ejecutor|integrante)_\d+_/i;

/**
 * Datos que el sistema imprime en los formatos y que nadie diligencia: quién
 * aprobó y con qué firma, quién responde por la actividad y cuándo se inspeccionó.
 */
export const RESERVED_DOCUMENT_FIELD_IDS = new Set([
  'coordinacion_nombre',
  'coordinacion_firma',
  'responsable_nombre',
  'responsable_firma',
  'fecha_hora',
]);

/** Momento del flujo en que se diligencia un campo: al abrir o al cerrar la jornada. */
export type EtapaCampo = 'open' | 'close';

export function etapaDelCampo(field: { stage?: unknown }): EtapaCampo {
  return field.stage === 'close' ? 'close' : 'open';
}

/**
 * Obligatoriedad condicionada: el campo se exige solo cuando otro tiene cierto
 * valor (p. ej. la observación cuando el ítem se marca "No aplica").
 */
export type RequeridoSi = { field: string; equals: string };

export function requeridoSi(value: unknown): RequeridoSi | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { field, equals } = value as { field?: unknown; equals?: unknown };
  return typeof field === 'string' && typeof equals === 'string' ? { field, equals } : undefined;
}

export function isReservedSystemFieldId(fieldId: string): boolean {
  return (
    RESERVED_AUTOMATIC_FIELD_IDS.has(fieldId) ||
    RESERVED_SIGNATURE_FIELD_IDS.has(fieldId) ||
    RESERVED_IDENTITY_FIELD_IDS.has(fieldId) ||
    RESERVED_DOCUMENT_FIELD_IDS.has(fieldId) ||
    RESERVED_CREW_ROW_PATTERN.test(fieldId)
  );
}

export function isReservedNonAutomaticFieldId(fieldId: string): boolean {
  return isReservedSystemFieldId(fieldId) && !RESERVED_AUTOMATIC_FIELD_IDS.has(fieldId);
}
