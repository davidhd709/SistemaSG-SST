/**
 * Peligros del ATS HSE-FO-018 con sus riesgos y medidas de control, con el
 * texto y el orden de las casillas del formato.
 */
export const peligrosAts = [
  {
    clave: 'atrapamiento',
    nombre: 'Atrapamiento',
    riesgos: ['Muerte', 'Amputación', 'Aplastamiento'],
    controles: [
      'Bloqueo',
      'Mantener distancia',
      'Guardas o protecciones',
      'No usar ropa suelta',
      'Extensiones de herramientas / Evita usar las manos',
    ],
  },
  {
    clave: 'espacio_confinado',
    nombre: 'Espacio confinado',
    riesgos: ['Muerte', 'Asfixia', 'Intoxicación'],
    controles: [
      'Chequeo medico diario / previo a la tarea',
      'Permiso para espacio confinado',
      'Ventilación / Extracción',
      'Medidor de gases',
      'Vigía',
    ],
  },
  {
    clave: 'altura',
    nombre: 'Trabajo en altura',
    riesgos: ['Muerte', 'Fracturas', 'Caídas a diferente nivel'],
    controles: [
      'Chequeo médico diario',
      'Uso de arnés cuerpo completo',
      'Línea de vida con doble gancho',
      'Siempre sujeto a puntos fijos',
      'Acordonar parte inferior',
    ],
  },
  {
    clave: 'equipos_moviles',
    nombre: 'Interacción con equipos móviles',
    riesgos: ['Muerte', 'Atropellamiento', 'Aplastamiento'],
    controles: [
      'Mantener distancia mínima 4mt',
      'Acordonamiento',
      'Respetar señalización',
      'Check-list de equipo',
      'Licencia vigente',
    ],
  },
  {
    clave: 'caida_objetos',
    nombre: 'Caída de objetos de manipulación',
    riesgos: ['Muerte', 'Fracturas', 'Atrapamiento'],
    controles: [
      'Mantener distancia igual a la altura de cargas',
      'Asegurar estabilidad de carga',
      'Check-list de eslingas',
      'Venteos para guiar cargas',
      'Vigilar el traslado de la carga',
    ],
  },
  {
    clave: 'incendio',
    nombre: 'Incendio',
    riesgos: ['Muerte', 'Asfixia', 'Quemadura'],
    controles: [
      'Retirar, proteger y limpiar materiales combustibles',
      'Permiso de fuego, vigía',
      'Vigía en zonas de alto riesgo',
      'Extintor',
      'Analizador de gas',
    ],
  },
  {
    clave: 'sustancias',
    nombre: 'Exposición a gases y sustancias peligrosas',
    riesgos: ['Muerte', 'Quemadura química', 'Intoxicación'],
    controles: [
      'Guantes para sustancias químicas',
      'Ropa para sustancias peligrosas',
      'Careta facial',
      'Leer hojas de seguridad',
      'Evitar mezclar sustancias',
    ],
  },
  {
    clave: 'calor',
    nombre: 'Exposición a calor o temperatura',
    riesgos: ['Golpe de calor', 'Deshidratación', 'Quemaduras'],
    controles: ['Ventilar el ambiente', 'Descansos periódicos', 'Hidratación', 'Chamarra anti-flama'],
  },
];

export const otrosPeligrosAts = [
  { clave: 'metal_fundido', nombre: 'Metal fundido' },
  { clave: 'punzantes', nombre: 'Elementos punzantes o cortantes' },
  { clave: 'derrumbes', nombre: 'Derrumbes o desplomes' },
  { clave: 'tanque_liquidos', nombre: 'Tanque con líquidos' },
  { clave: 'otros', nombre: 'Otros' },
  { clave: 'radiaciones', nombre: 'Radiaciones (Rayos X, Gamma, otras)' },
  { clave: 'particulas', nombre: 'Partículas en el ambiente' },
  { clave: 'desniveles', nombre: 'Desniveles' },
  { clave: 'polvos', nombre: 'Polvos' },
];

export const eppAts = [
  'Protección respiratoria',
  'Polainas de seguridad',
  'Pechera de protección',
  'Mangas de seguridad',
  'Capucha',
  'Ropa antiflama',
  'Arc flash',
  'Careta de protección',
  'Arnés de seguridad',
  'Ropa antiquímicos',
];

const DATOS = 'Análisis de trabajo seguro';
const LIMITACIONES = 'Limitaciones personales';
const OTROS = 'Otros peligros';
const ENERGIAS = 'Equipo de protección y energías';
const ENTREGA = 'Entrega de la tarea';

export const safeWorkAnalysisSchema = {
  title: 'Análisis de trabajo seguro (ATS)',
  source: { code: 'HSE-FO-018', version: '02', date: '2025-08-15' },
  fields: [
    {
      id: 'fecha_trabajo',
      type: 'auto',
      label: 'Fecha de elaboración y de vigencia',
      // Un ATS por día: se elabora y rige el mismo día.
      required: true,
      order: 1,
      section: DATOS,
      source: 'workDate',
    },
    { id: 'obra', type: 'text', label: 'Obra', required: true, order: 2, section: DATOS, maxLength: 80 },
    { id: 'compania', type: 'text', label: 'Compañía', required: true, order: 3, section: DATOS, maxLength: 80 },
    {
      id: 'area_labor',
      type: 'text',
      label: 'Área donde se realizará la labor',
      required: true,
      order: 4,
      section: DATOS,
      maxLength: 120,
    },
    {
      id: 'limitacion_primera_vez',
      type: 'yes_no',
      label: '¿Es la primera vez que realizan esta actividad?',
      required: true,
      order: 10,
      section: LIMITACIONES,
    },
    {
      id: 'limitacion_entrenamiento',
      type: 'yes_no',
      label: '¿Tienen los trabajadores el entrenamiento/experiencia requerida para el trabajo?',
      required: true,
      order: 11,
      section: LIMITACIONES,
    },
    {
      id: 'limitacion_herramientas',
      type: 'yes_no',
      label: '¿Están entrenados en el uso de las herramientas que se van a utilizar?',
      required: true,
      order: 12,
      section: LIMITACIONES,
    },
    {
      id: 'condiciones_meteorologicas',
      type: 'textarea',
      label:
        '¿Alguna situación meteorológica lo pone en situación de peligro? (Lluvia, tormentas eléctricas, vientos etc.) Observaciones / Medidas a tomar',
      required: true,
      order: 13,
      section: LIMITACIONES,
      maxLength: 200,
    },
    {
      id: 'actividad',
      type: 'textarea',
      label: 'Describa la actividad a realizar',
      required: true,
      order: 14,
      section: LIMITACIONES,
      maxLength: 400,
    },
    ...peligrosAts.flatMap((peligro, index) => {
      // Dos peligros por paso, como en las páginas del formato.
      const section = `Peligros, riesgos y controles (${Math.floor(index / 2) + 1} de ${peligrosAts.length / 2})`;
      const order = 20 + index * 3;
      return [
        {
          id: `${peligro.clave}_riesgos`,
          type: 'multi_select',
          label: `${peligro.nombre}: riesgos`,
          required: false,
          order,
          options: peligro.riesgos,
          section,
        },
        {
          id: `${peligro.clave}_controles`,
          type: 'multi_select',
          label: `${peligro.nombre}: controles`,
          required: false,
          order: order + 1,
          options: peligro.controles,
          section,
        },
        {
          id: `${peligro.clave}_otro`,
          type: 'text',
          label: `${peligro.nombre}: otro riesgo o control (si es necesario)`,
          required: false,
          order: order + 2,
          section,
          maxLength: 60,
        },
      ];
    }),
    ...otrosPeligrosAts.map((peligro, index) => ({
      id: `otro_peligro_${peligro.clave}`,
      type: 'yes_no',
      label: peligro.nombre,
      required: true,
      order: 60 + index,
      section: OTROS,
    })),
    {
      id: 'controles_otros_peligros',
      type: 'textarea',
      label: 'Indique los controles para los peligros identificados',
      required: false,
      order: 70,
      section: OTROS,
      maxLength: 300,
    },
    {
      id: 'epp',
      type: 'multi_select',
      label: 'Equipo de protección personal específico',
      required: false,
      order: 80,
      options: eppAts,
      section: ENERGIAS,
    },
    {
      id: 'bloqueo_requerido',
      type: 'yes_no',
      label:
        '¿Hay alguna fuente de energía tal como eléctrica, mecánica, hidráulica, neumática que lo coloque en situación de riesgo y requiera ser bloqueada?',
      required: true,
      order: 81,
      section: ENERGIAS,
    },
    {
      id: 'bloqueo_efectivo',
      type: 'yes_no',
      label: '¿Fue ejecutado el bloqueo efectivo?',
      required: false,
      requiredWhen: { field: 'bloqueo_requerido', equals: 'SI' },
      order: 82,
      section: ENERGIAS,
    },
    {
      id: 'bloqueo_tarjeta',
      type: 'text',
      label: 'Número de la tarjeta de bloqueo y/o candado',
      required: false,
      requiredWhen: { field: 'bloqueo_efectivo', equals: 'SI' },
      order: 83,
      section: ENERGIAS,
      maxLength: 20,
    },
    {
      id: 'energia_remanente',
      type: 'yes_no',
      label: '¿Existe alguna energía remanente?',
      required: true,
      order: 84,
      section: ENERGIAS,
    },
    {
      id: 'energia_remanente_cual',
      type: 'text',
      label: 'Indique cuál energía remanente',
      required: false,
      requiredWhen: { field: 'energia_remanente', equals: 'SI' },
      order: 85,
      section: ENERGIAS,
      maxLength: 120,
    },
    {
      id: 'novedades',
      type: 'textarea',
      label: 'Novedades',
      required: false,
      order: 86,
      section: ENERGIAS,
      maxLength: 600,
    },
    // Se diligencian al cerrar la jornada: el formato pide hacerlo una vez terminada la tarea.
    {
      id: 'entrega_operacion_segura',
      type: 'yes_no',
      label: '¿Se dejó en condiciones de operación segura?',
      required: true,
      order: 90,
      section: ENTREGA,
      stage: 'close',
    },
    {
      id: 'entrega_medidas',
      type: 'textarea',
      label: 'En caso de NO, mencione las medidas de control que se deben tomar',
      required: false,
      requiredWhen: { field: 'entrega_operacion_segura', equals: 'NO' },
      order: 91,
      section: ENTREGA,
      stage: 'close',
      maxLength: 200,
    },
    {
      id: 'entrega_orden_limpieza',
      type: 'yes_no',
      label: '¿El área que se entregó está en orden y limpia?',
      required: true,
      order: 92,
      section: ENTREGA,
      stage: 'close',
    },
  ],
};
