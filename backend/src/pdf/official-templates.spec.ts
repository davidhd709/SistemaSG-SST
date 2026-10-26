import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { PNG } from 'pngjs';
import { TemplateRegistry } from './template-registry';
import { TemplateLoader, type CheckboxField, type TemplateMapping } from './template-loader';
import { FieldRenderer, type ResolvedSignature } from './field-renderer';
import { TextRenderer } from './renderers/text.renderer';
import { CheckboxRenderer } from './renderers/checkbox.renderer';
import { ImageRenderer } from './renderers/image.renderer';
import { CrewTableRenderer } from './renderers/crew-table.renderer';
import { isReservedSystemFieldId } from '../forms/form-schema-policy';
import { PERFILES_FORMATO } from '../forms/form-profiles';
import { safeWorkAnalysisSchema } from '../../prisma/seed-data/safe-work-analysis';
import { electricalPermitSchema } from '../../prisma/seed-data/electrical-permit';
import { ladderInspectionSchema } from '../../prisma/seed-data/ladder-inspection';

type Campo = { id: string; type: string; options?: string[] };

/** Formatos oficiales que se imprimen sobre su PDF original sin modificarlo. */
const FORMATOS: { code: string; schema: { fields: Campo[] } }[] = [
  { code: 'HSE-FO-018', schema: safeWorkAnalysisSchema as { fields: Campo[] } },
  { code: 'FORSG-03', schema: electricalPermitSchema as { fields: Campo[] } },
  { code: 'HSE-FO-023', schema: ladderInspectionSchema as { fields: Campo[] } },
];

function firmaDePrueba(): Buffer {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 5; x < 115; x++) {
    const y = 20 + Math.round(10 * Math.sin(x / 9));
    for (let dy = -1; dy <= 1; dy++) {
      const idx = (png.width * (y + dy) + x) << 2;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** Respuestas que llenan cada campo del esquema, para ver el documento completo. */
function respuestasCompletas(schema: { fields: Campo[] }): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  let vuelta = 0;
  for (const campo of schema.fields) {
    if (campo.type === 'multi_select') answers[campo.id] = campo.options ?? [];
    // Rota las opciones para ver todas las marcas (√, X, NA) en la muestra.
    else if (campo.type === 'select') answers[campo.id] = campo.options?.[vuelta++ % campo.options.length];
    else if (campo.type === 'yes_no') answers[campo.id] = 'SI';
    else if (campo.type === 'textarea')
      answers[campo.id] = 'Texto de prueba que ocupa varias líneas del renglón impreso. '.repeat(4);
    else if (campo.type === 'text') answers[campo.id] = `Prueba ${campo.id}`;
  }
  return answers;
}

async function cargar(code: string): Promise<{ mapping: TemplateMapping; templatePath: string; mappingPath: string }> {
  const registry = new TemplateRegistry();
  const { templatePath, mappingPath } = await registry.resolve(code);
  const mapping = JSON.parse(await readFile(mappingPath, 'utf8')) as TemplateMapping;
  return { mapping, templatePath, mappingPath };
}

describe.each(FORMATOS)('Plantilla oficial $code', ({ code, schema }) => {
  it('conserva el PDF oficial intacto y declara sus páginas', async () => {
    const { mapping, templatePath, mappingPath } = await cargar(code);
    const bytes = await readFile(templatePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(mapping.meta.templateSha256);
    const { pageCount, pdfDoc } = await new TemplateLoader().load(templatePath, mappingPath);
    expect(pageCount).toBe(mapping.meta.pageCount);
    const { width, height } = pdfDoc.getPage(0).getSize();
    expect({ width: Math.round(width), height: Math.round(height) }).toEqual(mapping.meta.pageSize);
  });

  it('imprime solo campos del esquema o datos del sistema, con opciones existentes', async () => {
    const { mapping } = await cargar(code);
    const campos = new Map(schema.fields.map((campo) => [campo.id, campo]));
    for (const [clave, campo] of Object.entries(mapping.fields)) {
      if (campo.type === 'CHECKBOX') {
        const { field, includes, equals } = (campo as CheckboxField).checkedWhen;
        if (isReservedSystemFieldId(field)) continue;
        const definido = campos.get(field);
        expect({ clave, campo: field, existe: Boolean(definido) }).toEqual({ clave, campo: field, existe: true });
        const opcion = includes ?? equals;
        const opciones = definido!.type === 'yes_no' ? ['SI', 'NO'] : (definido!.options ?? []);
        expect({ clave, opcion, valida: opciones.includes(opcion!) }).toEqual({ clave, opcion, valida: true });
      } else if (['TEXT', 'MULTILINE_TEXT', 'NUMBER'].includes(campo.type) && !isReservedSystemFieldId(clave)) {
        expect({ clave, existe: campos.has(clave) }).toEqual({ clave, existe: true });
      }
    }
  });

  it('tiene una fila con firma por cada integrante que admite el formato', async () => {
    const { mapping } = await cargar(code);
    const filas = new Set(
      Object.values(mapping.fields)
        .filter((campo) => campo.type === 'SIGNATURE' && typeof campo.memberIndex === 'number')
        .map((campo) => (campo as { memberIndex: number }).memberIndex),
    );
    expect(filas.size).toBe(PERFILES_FORMATO[code].maxIntegrantes);
  });

  it('superpone un envío completo sin errores', async () => {
    const { templatePath, mappingPath } = await cargar(code);
    const { pdfDoc, mapping } = await new TemplateLoader().load(templatePath, mappingPath);
    const firma = firmaDePrueba();
    const perfil = PERFILES_FORMATO[code];
    const answers: Record<string, unknown> = {
      ...respuestasCompletas(schema),
      fecha_trabajo: '23/10/2026',
      vigencia_permiso: '23/10/2026',
      hora_inicio: '07:05 a.m.',
      hora_fin: '04:40 p.m.',
      fecha_hora: '23/10/2026 07:05 a.m.',
      responsable_nombre: 'Oficial de Prueba',
      coordinacion_nombre: 'Coordinadora de Prueba',
    };
    const signatures: ResolvedSignature[] = [
      { fieldKey: 'responsable_firma', imageBytes: firma },
      { fieldKey: 'coordinacion_firma', imageBytes: firma },
    ];
    for (let i = 0; i < perfil.maxIntegrantes; i++) {
      const idx = String(i + 1).padStart(2, '0');
      answers[`integrante_${idx}_nombre`] = `Integrante ${idx} Apellido`;
      answers[`integrante_${idx}_cedula`] = `10${idx}456789`;
      answers[`integrante_${idx}_cargo`] = 'Auxiliar eléctrico';
      answers[`integrante_${idx}_dia`] = String((i % 7) + 1);
      signatures.push({ memberIndex: i, imageBytes: firma });
      signatures.push({ fieldKey: `integrante_${idx}_firma_cierre`, imageBytes: firma });
    }
    const renderer = new FieldRenderer(
      new TextRenderer(),
      new CheckboxRenderer(),
      new ImageRenderer(),
      new CrewTableRenderer(new ImageRenderer()),
    );
    await renderer.render(pdfDoc, mapping, { answers, signatures });
    const bytes = await pdfDoc.save();
    expect(bytes.length).toBeGreaterThan(1000);
    // Para revisar la calibración a ojo: PDF_MUESTRAS=<carpeta> npx jest official-templates
    const salida = process.env.PDF_MUESTRAS;
    if (salida) await writeFile(path.join(salida, `${code}.pdf`), bytes);
  });
});

describe('Texto sobre renglones impresos', () => {
  it('escribe un texto corto en el primer renglón, no centrado entre renglones', async () => {
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const drawText = jest.spyOn(page, 'drawText');
    // Siete renglones con el primero en la línea base 169.5 (novedades del ATS).
    new TextRenderer().render({
      page,
      font,
      value: 'Sin novedades.',
      field: {
        type: 'MULTILINE_TEXT',
        page: 0,
        x: 38,
        y: 88.9,
        width: 532,
        height: 90.6,
        fontSize: 10,
        lineHeight: 13.4,
      },
    });
    expect(drawText).toHaveBeenCalledTimes(1);
    expect(drawText.mock.calls[0][1]?.y).toBeCloseTo(169.5, 1);
  });
});
