/**
 * Formatos oficiales que el colaborador diligencia desde la app. Cada uno se
 * envía suelto y pasa por Coordinación; el flujo de cada formato (charla,
 * cuadrilla, jornada, firmas) lo informa la API en `perfil`.
 */
export type FormatoOficial = {
  codigo: string;
  /** Segmento de la ruta: /formulario/<slug>. */
  slug: string;
  titulo: string;
  descripcion: string;
};

export const FORMATOS: readonly FormatoOficial[] = [
  {
    codigo: 'HSE-FO-016',
    slug: 'alturas',
    titulo: 'Permiso de trabajo en altura',
    descripcion: 'Antes de subir: charla, cuadrilla, lista de verificación y firmas.',
  },
  {
    codigo: 'HSE-FO-018',
    slug: 'ats',
    titulo: 'Análisis de trabajo seguro (ATS)',
    descripcion: 'Uno por día: peligros, riesgos, controles, EPP y entrega de la tarea.',
  },
  {
    codigo: 'FORSG-03',
    slug: 'electrico',
    titulo: 'Permiso de trabajo - riesgo eléctrico',
    descripcion: 'Desconexión, ejecución y reconexión, con firma de inicio y de término.',
  },
  {
    codigo: 'HSE-FO-023',
    slug: 'escalera',
    titulo: 'Inspección de escaleras',
    descripcion: 'Estado de cada parte de la escalera y conclusión antes de usarla.',
  },
];

export function formatoPorSlug(slug: string | null): FormatoOficial | undefined {
  return FORMATOS.find((formato) => formato.slug === slug);
}

/** Ruta del formulario de un formato; si el código no se conoce, el selector. */
export function rutaFormato(codigo: string): string {
  const formato = FORMATOS.find((candidato) => candidato.codigo === codigo);
  return formato ? `/formulario/${formato.slug}` : '/formatos';
}
