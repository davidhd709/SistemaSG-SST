export type TipoCampo = 'text' | 'textarea' | 'yes_no' | 'select' | 'multi_select' | 'number' | 'date' | 'auto';

export type Campo = {
  id: string;
  type: TipoCampo;
  label: string;
  required: boolean;
  options?: string[];
  order: number;
  section?: string;
  /** Para los campos `auto`: de dónde toma el sistema el valor. */
  source?: string;
  /** `close`: se diligencia al cerrar la jornada, no al enviar. */
  stage?: 'open' | 'close';
  /** Se vuelve obligatorio cuando otro campo tiene este valor. */
  requiredWhen?: { field: string; equals: string };
};

/** Cómo se recorre cada formato; lo define la API. */
export type PerfilFormato = {
  code: string;
  maxIntegrantes: number;
  charla: boolean;
  certificadoAlturas: boolean;
  jornada: boolean;
  firmaCierre: boolean;
  firmaCoordinacion: boolean;
};

export type Definicion = { name: string; versionNumber: number; schemaJson: { fields: Campo[] } };

export type Flujo = {
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  /** En Alcalá la charla se ve en video; en Montelíbano se dicta en persona. */
  sede?: { code: string; nombre: string; charlaEnVideo: boolean };
  arl: { status: string; providerName?: string; endDate?: string };
  cumplimiento?: {
    apto: boolean;
    faltantes: string[];
    alturas?: { estado: string };
    seguridadSocial?: { estado: string };
  };
  /** Permiso autorizado y aún sin cerrar, si lo hay. */
  jornadaAbierta?: { id: string; workDate: string | null; startedAt: string | null } | false | null;
  canContinue: boolean;
  perfil: PerfilFormato;
};

export type Envio = {
  id: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'CLOSED' | 'REJECTED' | 'EXPIRED';
  submittedAt?: string | null;
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  approval?: { reason?: string | null } | null;
  /** El oficial puede corregir y reenviar este permiso rechazado. */
  correctable?: boolean;
  members?: {
    isLead: boolean;
    collaborator: { id: string; firstName: string; lastName: string; documentNumber?: string };
  }[];
} | null;

/** Permiso rechazado que el oficial está corrigiendo. */
export type Correccion = {
  id: string;
  workDate: string | null;
  reason: string | null;
  answers: Record<string, unknown>;
  members: { collaboratorId: string; jobPositionId: string | null; isLead: boolean }[];
};

/** Un paso del formulario: una sección del esquema publicado. */
export type Bloque = { titulo: string; campos: Campo[] };

export type Etapa = 'arl' | 'charla' | 'cuadrilla' | 'formulario' | 'revision' | 'firma' | 'resultado';

/** Colaborador que hoy cumple los requisitos y puede integrar la cuadrilla. */
export type Candidato = {
  id: string;
  firstName: string;
  lastName: string;
  documentNumber: string;
  jobTitle: string | null;
  team: string | null;
};

export type Cargo = { id: string; code: string; name: string; canLead: boolean };

/**
 * Videos disponibles para la charla previa al inicio de labores.
 * Agrega los archivos con estos nombres en `src/assets/videos/charlas-seguridad/`.
 */
export const CHARLAS_DE_SEGURIDAD = [
  '/assets/videos/charlas-seguridad/charla-01.mp4',
  '/assets/videos/charlas-seguridad/charla-02.mp4',
  '/assets/videos/charlas-seguridad/charla-03.mp4',
];

/** Integrante elegido, con su cargo y su firma una vez capturada. */
export type Integrante = {
  candidato: Candidato;
  jobPositionId: string;
  firmaDataUrl: string | null;
};

export const BORRADOR = 'sg-sst.borrador';

/** Campos que se diligencian al enviar; los de cierre se piden al terminar la tarea. */
export function esCampoDeApertura(campo: Campo): boolean {
  return campo.stage !== 'close';
}

/** Obligatorio por sí mismo o porque otra respuesta lo activa. */
export function esObligatorio(campo: Campo, valor: (id: string) => unknown): boolean {
  if (campo.required) return true;
  return Boolean(campo.requiredWhen && valor(campo.requiredWhen.field) === campo.requiredWhen.equals);
}

export function agruparCamposEnBloques(fields: Campo[] = []): Bloque[] {
  const campos = fields.slice().sort((a, b) => a.order - b.order);
  const bloques: Bloque[] = [];
  let titulo = 'Datos del permiso';
  for (const campo of campos) {
    if (campo.section) titulo = campo.section;
    const bloque = bloques.find((candidato) => candidato.titulo === titulo);
    if (bloque) bloque.campos.push(campo);
    else bloques.push({ titulo, campos: [campo] });
  }
  return bloques;
}

export function calcularPorcentajeAvance(etapa: Etapa, indiceBloque: number, totalBloques: number): number {
  const total = 4 + totalBloques;
  const orden: Record<Etapa, number> = {
    arl: 0,
    charla: 1,
    cuadrilla: 2,
    formulario: 3 + indiceBloque,
    revision: 3 + totalBloques,
    firma: 4 + totalBloques,
    resultado: total + 1,
  };
  return Math.min(100, Math.round((orden[etapa] / (total + 1)) * 100));
}

export function textoRequisitoCumplimiento(estado?: string): string {
  if (estado === 'VIGENTE') return 'Vigente y verificado';
  if (estado === 'PROXIMA_A_VENCER') return 'Vigente, próximo a vencer';
  return 'No vigente';
}

export function obtenerValorAutomatico(campo: Campo, cumplimiento?: Flujo['cumplimiento'], ahora = new Date()): string {
  switch (campo.source) {
    case 'workDate':
      return ahora.toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'America/Bogota',
      });
    case 'startedAt':
      return 'Se registra al iniciar la jornada';
    case 'closedAt':
      return 'Se registra al cerrar la jornada';
    case 'heightCertificate':
      return textoRequisitoCumplimiento(cumplimiento?.alturas?.estado);
    case 'socialSecurity':
      return textoRequisitoCumplimiento(cumplimiento?.seguridadSocial?.estado);
    default:
      return '—';
  }
}

export function obtenerExplicacionAuto(campo: Campo): string {
  switch (campo.source) {
    case 'workDate':
      return 'El permiso rige solo hoy.';
    case 'startedAt':
      return 'Se registra después de la aprobación, cuando comiencen las labores.';
    case 'closedAt':
      return 'Cuando terminen, cierra la jornada desde la app.';
    case 'heightCertificate':
    case 'socialSecurity':
      return 'Verificado con lo que cargó Coordinación.';
    default:
      return '';
  }
}

export function normalizarRespuestasFormulario(
  valores: Record<string, unknown>,
  fields: Campo[] = [],
): Record<string, unknown> {
  const copia = { ...valores };
  for (const campo of fields) {
    if (campo.type === 'number' && typeof copia[campo.id] === 'string') {
      copia[campo.id] = Number(copia[campo.id]);
    }
  }
  return copia;
}
