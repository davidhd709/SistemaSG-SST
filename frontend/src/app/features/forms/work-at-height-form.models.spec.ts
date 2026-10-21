import {
  agruparCamposEnBloques,
  calcularPorcentajeAvance,
  normalizarRespuestasFormulario,
  obtenerValorAutomatico,
  type Campo,
} from './work-at-height-form.models';

describe('work-at-height-form.models (AUD-016 / AUD-013)', () => {
  const fields: Campo[] = [
    { id: 'item_2', type: 'yes_no', label: 'Arnés', required: true, order: 2, section: 'EPP' },
    { id: 'empresa', type: 'text', label: 'Empresa', required: true, order: 1, section: 'Datos básicos' },
    { id: 'altura_m', type: 'number', label: 'Altura (m)', required: true, order: 3 },
  ];

  it('ordena los campos por order y hereda la última sección declarada', () => {
    const bloques = agruparCamposEnBloques(fields);
    expect(bloques).toHaveLength(2);
    expect(bloques[0].titulo).toBe('Datos básicos');
    expect(bloques[0].campos.map((c) => c.id)).toEqual(['empresa']);
    expect(bloques[1].titulo).toBe('EPP');
    expect(bloques[1].campos.map((c) => c.id)).toEqual(['item_2', 'altura_m']);
  });

  it('calcula el porcentaje de avance y convierte campos numéricos en string a number', () => {
    expect(calcularPorcentajeAvance('arl', 0, 2)).toBe(0);
    expect(calcularPorcentajeAvance('resultado', 0, 2)).toBe(100);
    expect(normalizarRespuestasFormulario({ empresa: 'ACME', altura_m: '12.5' }, fields)).toEqual({
      empresa: 'ACME',
      altura_m: 12.5,
    });
  });

  it('muestra la vista previa de campos automáticos según el estado de cumplimiento', () => {
    const campoCert: Campo = {
      id: 'certificado_alturas',
      type: 'auto',
      label: 'Certificado',
      required: false,
      order: 1,
      source: 'heightCertificate',
    };
    expect(
      obtenerValorAutomatico(campoCert, {
        apto: true,
        faltantes: [],
        alturas: { estado: 'VIGENTE' },
      }),
    ).toBe('Vigente y verificado');
  });
});
