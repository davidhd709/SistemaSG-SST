/** Ítems de verificación del formato FORSG-03, agrupados como en el documento. */
export const verificacionElectrica = [
  {
    clave: 'd',
    seccion: '1. Desconexión del equipo',
    items: [
      '¿Realizo inspección planeada para la aprobación de este permiso?',
      '¿Se tiene conocimiento claro y preciso de las tareas a realizar y se divulgó el panorama de peligros al personal involucrado en la tarea?',
      'El trabajo implica actividad por encima de 600 voltios?',
      'Si se va a medir tensión unicamente por encima de 600 voltios se cuenta con la utilización de instrumentos especiales para estas medidas?',
      '¿Se realizó la desconexión de la/las fuente(s) de alimentación eléctrica?',
      '¿Se bloqueó la fuente de alimentación y se etiquetó?',
      '¿Se verificó la ausencia de tensión en el área o equipo donde se realizará el trabajo?',
      '¿Se realizó la conexión a tierra de todas aquellas posibles fuentes de tensión?',
      '¿Se delimitó y señalizó el área de trabajo?',
    ],
  },
  {
    clave: 'e',
    seccion: '2. Ejecución del trabajo',
    items: [
      '¿El personal cuenta con EPP adecuado y de material aislante?',
      '¿Las herramientas están en buen estado y cuentan con aislamiento eléctrico?',
      '¿Los equipos de medición se encuentran en buen estado?',
    ],
  },
  {
    clave: 'r',
    seccion: '3. Reconexión del equipo',
    items: [
      '¿Se verificó que no se encuentra personal trabajando en los equipos?',
      '¿Se verificó que los equipos se encuentran cubiertos o aislados?',
      '¿Se verificó que no hay conexiones desnudas (sin recubrimiento)?',
      '¿No hay personas en contacto o cerca de lugares donde exista riesgo de shock eléctrico?',
      '¿Los interruptores se encuentran abiertos y los equipos no se energizarán al conectar la fuente?',
    ],
  },
];

/** Equipo de seguridad industrial, por columnas como en el formato. */
export const eppElectrico = [
  'Botas dieléctricas',
  'Gafas de seguridad',
  'Casco dieléctrico',
  'Tarjeta de identificación (para bloqueo)',
  'Candado de seguridad',
  'Delantales',
  'Balaclava dieléctrica',
  'Tapete dieléctrico',
  'Guantes de cuero / badana',
  'Guantes dieléctrico',
  'Guante de cuero cromado',
  'Overol FR',
  'Arnés de seguridad especial Riesgo Electrico',
  'Vestido de neopreno/ignifugo',
  'Línea de anclaje sin absorbedor de impacto',
  'Orejeras',
  'Tapón auditivo',
  'Full face',
  'Respirador',
  'Capuchas',
  'Visor pantalla',
  'Megger',
  'Multimetro',
];

/** Leyenda del formato: Correcto √, Incorrecto ×, No aplica NA. */
export const VERIFICACION = ['Correcto', 'Incorrecto', 'No aplica'];

const DATOS = 'Datos del trabajo';

export const electricalPermitSchema = {
  title: 'Permiso de trabajo - riesgo eléctrico',
  source: { code: 'FORSG-03', version: '002', date: 'Enero 2020' },
  fields: [
    { id: 'trabajo', type: 'text', label: 'Trabajo', required: true, order: 1, section: DATOS, maxLength: 120 },
    { id: 'ubicacion', type: 'text', label: 'Ubicación', required: true, order: 2, section: DATOS, maxLength: 120 },
    { id: 'actividad', type: 'text', label: 'Actividad', required: true, order: 3, section: DATOS, maxLength: 120 },
    {
      id: 'fecha_trabajo',
      type: 'auto',
      label: 'Fecha',
      // El permiso tiene vigencia de un día.
      required: true,
      order: 4,
      section: DATOS,
      source: 'workDate',
    },
    {
      id: 'hora_inicio',
      type: 'auto',
      label: 'Hora inicio',
      required: true,
      order: 5,
      section: DATOS,
      source: 'startedAt',
    },
    { id: 'hora_fin', type: 'auto', label: 'Hora final', required: true, order: 6, section: DATOS, source: 'closedAt' },
    ...verificacionElectrica.flatMap((grupo, g) =>
      grupo.items.flatMap((label, index) => {
        const id = `verif_${grupo.clave}${String(index + 1).padStart(2, '0')}`;
        return [
          {
            id,
            type: 'select',
            label,
            required: true,
            order: 100 + g * 40 + index * 2,
            options: VERIFICACION,
            section: grupo.seccion,
          },
          {
            id: `${id}_obs`,
            type: 'text',
            label: 'Observaciones',
            // Instrucción 4 del formato: un N/A debe sustentarse en observaciones.
            required: false,
            requiredWhen: { field: id, equals: 'No aplica' },
            order: 101 + g * 40 + index * 2,
            section: grupo.seccion,
            maxLength: 90,
          },
        ];
      }),
    ),
    {
      id: 'descripcion',
      type: 'textarea',
      label: 'Descripción del trabajo',
      required: true,
      order: 300,
      section: '4. Descripción y equipo de seguridad',
      maxLength: 400,
    },
    {
      id: 'epp',
      type: 'multi_select',
      label: 'Equipo de seguridad industrial (incluye elementos de protección personal)',
      required: true,
      order: 301,
      options: eppElectrico,
      section: '4. Descripción y equipo de seguridad',
    },
    {
      id: 'epp_otros',
      type: 'text',
      label: 'Otros (indique)',
      required: false,
      order: 302,
      section: '4. Descripción y equipo de seguridad',
      maxLength: 80,
    },
    {
      id: 'herramientas',
      type: 'textarea',
      label: 'Herramientas, equipos y materiales',
      required: true,
      order: 303,
      section: '4. Descripción y equipo de seguridad',
      maxLength: 300,
    },
  ],
};
