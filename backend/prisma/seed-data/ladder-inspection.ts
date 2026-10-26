/** Partes a examinar, en el orden y con el texto del formato HSE-FO-023. */
export const partesEscalera = [
  'Largueros (en buen estado)',
  'Peldaños (antideslizantes, no torcidos y en buen estado)',
  'Unión de peldaños y largueros',
  'Zapatas antideslizantes',
  'Piezas de ajuste (tornillos, pernos, otros)',
  'Aseo de escalera (libre de sustancias deslizantes)',
  'Identificación legible en la escalera',
  'Cuenta con señalización de seguridad en peldaño',
  'Brazos de unión anti-apertura (aplica para escaleras tipo tijera)',
  'Ganchos trabapeldaños (aplica en tijeras extensibles)',
  'Guías externas para unión de largueros (aplica a tijeras extensibles)',
];

/** Leyenda del formato: √ Correcto, X Incorrecto, NA No aplica. */
export const ESTADOS = ['Correcto', 'Incorrecto', 'No aplica'];

const numero = (index: number) => String(index + 1).padStart(2, '0');

export const ladderInspectionSchema = {
  title: 'Formato de inspección de escaleras',
  source: { code: 'HSE-FO-023', version: '00', date: '2022-06-29' },
  fields: [
    {
      id: 'fecha_trabajo',
      type: 'auto',
      label: 'Fecha y hora',
      // La hora impresa es la del envío de la inspección.
      required: true,
      order: 1,
      section: 'Datos de la inspección',
      source: 'workDate',
    },
    {
      id: 'lugar',
      type: 'text',
      label: 'Lugar',
      required: true,
      order: 2,
      section: 'Datos de la inspección',
      maxLength: 120,
    },
    {
      id: 'tipo_escalera',
      type: 'text',
      label: 'Tipo de escalera',
      required: true,
      order: 3,
      section: 'Datos de la inspección',
      maxLength: 120,
    },
    ...partesEscalera.flatMap((label, index) => [
      {
        id: `parte_${numero(index)}`,
        type: 'select',
        label,
        required: true,
        order: 10 + index * 2,
        options: ESTADOS,
        section: 'Partes a examinar',
      },
      {
        id: `parte_${numero(index)}_obs`,
        type: 'text',
        label: `Observaciones: ${label}`,
        required: false,
        order: 11 + index * 2,
        section: 'Partes a examinar',
        maxLength: 80,
      },
    ]),
    {
      id: 'conclusion_apta',
      type: 'yes_no',
      label: 'Conclusión: ¿escalera apta para ser usada?',
      required: true,
      order: 50,
      section: 'Conclusión',
    },
    {
      id: 'justificacion',
      type: 'textarea',
      label: 'Justificación',
      required: false,
      requiredWhen: { field: 'conclusion_apta', equals: 'NO' },
      order: 51,
      section: 'Conclusión',
      maxLength: 300,
    },
  ],
};
