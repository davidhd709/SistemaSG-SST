import {
  agruparRespuestasDetalle,
  calcularDuracionDesde,
  formatearValorRespuesta,
  type Detail,
} from './coordination.models';

describe('coordination.models (AUD-016 / AUD-013)', () => {
  it('agrupa respuestas por sección, resalta incumplimientos (NO) y conserva claves históricas no presentes en el esquema', () => {
    const detail = {
      answersJson: {
        empresa: 'ACME',
        verificacion_1: 'NO',
        campo_historico: ['Casco', 'Arnés'],
      },
      formVersion: {
        versionNumber: 4,
        form: { code: 'HSE-FO-016', name: 'Permiso' },
        schemaJson: {
          fields: [
            { id: 'empresa', label: 'Empresa', order: 1, section: 'Datos básicos' },
            { id: 'verificacion_1', label: 'Punto de anclaje', order: 2, section: 'Verificación' },
          ],
        },
      },
    } as unknown as Detail;

    const grupos = agruparRespuestasDetalle(detail);
    expect(grupos.length).toBe(3);
    expect(grupos[0]).toEqual({
      seccion: 'Datos básicos',
      respuestas: [{ etiqueta: 'Empresa', valor: 'ACME', alerta: false }],
    });
    expect(grupos[1]).toEqual({
      seccion: 'Verificación',
      respuestas: [{ etiqueta: 'Punto de anclaje', valor: 'NO', alerta: true }],
    });
    expect(grupos[2]).toEqual({
      seccion: 'Otras respuestas registradas',
      respuestas: [{ etiqueta: 'campo_historico', valor: 'Casco, Arnés', alerta: false }],
    });
  });

  it('formatea valores nulos, booleanos y duraciones en labor', () => {
    expect(formatearValorRespuesta(null)).toBe('—');
    expect(formatearValorRespuesta(true)).toBe('Sí');
    expect(calcularDuracionDesde('2026-10-20T12:00:00.000Z', new Date('2026-10-20T13:25:00.000Z').getTime())).toBe(
      '1 h 25 min en labor',
    );
  });
});
