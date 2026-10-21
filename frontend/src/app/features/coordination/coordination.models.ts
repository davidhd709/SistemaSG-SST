export type Dashboard = {
  pending: number;
  inProgress: number;
  approved: number;
  closed: number;
  rejected: number;
  blockedByArl: number;
  overdue: number;
};

/** Jornada autorizada que sigue abierta. */
export type JornadaAbierta = {
  id: string;
  workDate: string | null;
  startedAt: string | null;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  crewSize: number;
  members: { collaborator: { firstName: string; lastName: string }; jobPosition: { name: string } | null }[];
  form: { code: string; name: string };
  overdue: boolean;
};

export type DocumentoCustodia = {
  id: string;
  status: string;
  workDate: string | null;
  submittedAt: string | null;
  startedAt: string | null;
  closedAt: string | null;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  members: {
    collaborator: { firstName: string; lastName: string; documentNumber: string };
    jobPosition: { name: string } | null;
  }[];
  form: { code: string; name: string; version: number };
  finalPdfFile: { id: string; originalName: string } | null;
};

export type PaginaCustodia = {
  items: DocumentoCustodia[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type Cumplimiento = {
  arl: { estado: string };
  seguridadSocial: { estado: string; reference?: string };
  alturas: { estado: string; expiresAt?: string };
  apto: boolean;
  faltantes: string[];
};

export type FilaCumplimiento = {
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string; jobTitle: string | null };
  cumplimiento: Cumplimiento;
};

export type Planilla = {
  id: string;
  reference: string;
  providerName: string | null;
  periodStart: string;
  periodEnd: string;
  file: { id: string; originalName: string } | null;
  members: { id: string; firstName: string; lastName: string }[];
};

export type Certificado = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  trainingEntity: string | null;
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string };
  file: { id: string; originalName: string } | null;
};

/** Integrante de la cuadrilla tal como lo ve Coordinación al revisar. */
export type Integrante = {
  id: string;
  isLead: boolean;
  collaborator: { id: string; firstName: string; lastName: string; documentNumber: string };
  jobPosition: { code: string; name: string } | null;
  signature: { sha256: string; file: { id: string } } | null;
  members: Integrante[];
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
  status?: string;
};

export type Submission = {
  id: string;
  submittedAt: string;
  collaborator: { firstName: string; lastName: string; documentNumber: string };
  form: { code: string; name: string; version: number };
};

export type Campo = { id: string; label: string; order: number; section?: string };

export type Detail = {
  id: string;
  submittedAt: string | null;
  safetyTalkConfirmedAt: string | null;
  answersJson: Record<string, unknown>;
  arlSnapshotJson: { providerName?: string; startDate?: string; endDate?: string; status?: string };
  collaborator: { firstName: string; lastName: string; documentNumber: string; jobTitle?: string; team?: string };
  formVersion: { versionNumber: number; schemaJson: { fields: Campo[] }; form: { code: string; name: string } };
  signature: { sha256: string; file: { id: string } } | null;
  members: Integrante[];
  status?: string;
  workDate?: string | null;
  startedAt?: string | null;
  closedAt?: string | null;
};

export type Colaborador = {
  id: string;
  documentType: string;
  documentNumber: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  team: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
};

export type FilaArl = {
  collaborator: { id: string; documentNumber: string };
  affiliation: { providerName: string; endDate: string } | null;
  arlStatus: 'VIGENTE' | 'PROXIMA_A_VENCER' | 'VENCIDA';
};

export type Respuesta = { etiqueta: string; valor: string; alerta: boolean };
export type Grupo = { seccion: string; respuestas: Respuesta[] };

export function formatearValorRespuesta(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (Array.isArray(valor)) return valor.join(', ');
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  return String(valor);
}

function agregarRespuestaGrupo(grupos: Grupo[], seccion: string, respuesta: Respuesta): void {
  const grupo = grupos.find((candidato) => candidato.seccion === seccion);
  if (grupo) grupo.respuestas.push(respuesta);
  else grupos.push({ seccion, respuestas: [respuesta] });
}

export function agruparRespuestasDetalle(item: Detail | null): Grupo[] {
  if (!item) return [];
  const campos = (item.formVersion.schemaJson?.fields ?? []).slice().sort((a, b) => a.order - b.order);
  const grupos: Grupo[] = [];
  let seccion = 'Datos del permiso';

  for (const campo of campos) {
    if (campo.section) seccion = campo.section;
    const valor = item.answersJson[campo.id];
    if (valor === undefined) continue;
    agregarRespuestaGrupo(grupos, seccion, {
      etiqueta: campo.label ?? campo.id,
      valor: formatearValorRespuesta(valor),
      alerta: valor === 'NO',
    });
  }

  const conocidos = new Set(campos.map((campo) => campo.id));
  for (const [id, valor] of Object.entries(item.answersJson)) {
    if (conocidos.has(id)) continue;
    agregarRespuestaGrupo(grupos, 'Otras respuestas registradas', {
      etiqueta: id,
      valor: formatearValorRespuesta(valor),
      alerta: valor === 'NO',
    });
  }
  return grupos;
}

export function calcularDuracionDesde(inicio: string | null, ahoraMs = Date.now()): string {
  if (!inicio) return 'Hora no registrada';
  const minutos = Math.max(0, Math.floor((ahoraMs - new Date(inicio).getTime()) / 60_000));
  const horas = Math.floor(minutos / 60);
  return horas ? `${horas} h ${minutos % 60} min en labor` : `${minutos} min en labor`;
}
