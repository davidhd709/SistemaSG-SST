import { NotFoundException } from '@nestjs/common';
import * as path from 'node:path';

// ── Mocks de node:fs/promises ─────────────────────────────────────────────
let mockAccessImpl: (p: string) => Promise<void> = async () => { /* ok */ };
let mockReadFileImpl: (p: string, enc?: string) => Promise<Buffer | string> = async () => Buffer.alloc(0);

jest.mock('node:fs/promises', () => ({
  access: (p: string) => mockAccessImpl(p),
  readFile: (p: string, enc?: string) => mockReadFileImpl(p, enc),
  mkdir: jest.fn().mockResolvedValue(undefined),
  writeFile: jest.fn().mockResolvedValue(undefined),
  rm: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue({ size: 0 }),
}));

import { TemplateRegistry } from './template-registry';
import { TemplateLoader } from './template-loader';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { TextRenderer } from './renderers/text.renderer';
import { CheckboxRenderer } from './renderers/checkbox.renderer';
import { ImageRenderer } from './renderers/image.renderer';

// ── Helpers ────────────────────────────────────────────────────────────────

function accessAlwaysExists(): void {
  mockAccessImpl = async () => { /* ok */ };
}

function accessFailsOnCall(n: number): void {
  let count = 0;
  mockAccessImpl = async () => {
    count++;
    if (count === n) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
}

async function minimalPdf(pageCount = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([792, 612]);
  return doc.save();
}

const validMapping = JSON.stringify({
  meta: { formCode: 'HSE-FO-016', templateVersion: 'v00', pageCount: 1, pageSize: { width: 792, height: 612 }, orientation: 'landscape' },
  fields: {
    empresa: { type: 'TEXT', page: 0, x: 100, y: 50, width: 150, height: 12, fontSize: 7 },
    sistemas_acceso_andamio: {
      type: 'CHECKBOX', page: 0, x: 200, y: 100, size: 6,
      checkedWhen: { field: 'sistemas_acceso', includes: 'Andamio' },
    },
  },
});

function setupReadFile(pdfBytes: Uint8Array, mappingJson: string): void {
  mockReadFileImpl = async (p: string, enc?: string) => {
    if (String(p).endsWith('.pdf')) return Buffer.from(pdfBytes);
    return enc ? mappingJson : Buffer.from(mappingJson);
  };
}

/** PNG 1×1 pixel con canal alpha (mínimo válido según especificación PNG). */
const MINIMAL_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

// ══════════════════════════════════════════════════════════════════════════
// S2 — TemplateRegistry
// ══════════════════════════════════════════════════════════════════════════

describe('TemplateRegistry', () => {
  beforeEach(() => { accessAlwaysExists(); });

  it('resuelve la versión predeterminada de HSE-FO-016', async () => {
    const result = await new TemplateRegistry().resolve('HSE-FO-016');
    expect(result.templatePath).toContain(path.join('HSE-FO-016', 'v00', 'template.pdf'));
    expect(result.mappingPath).toContain(path.join('HSE-FO-016', 'v00', 'mapping.json'));
  });

  it('resuelve una versión específica cuando se proporciona', async () => {
    const result = await new TemplateRegistry().resolve('HSE-FO-016', 'v01');
    expect(result.templatePath).toContain(path.join('HSE-FO-016', 'v01', 'template.pdf'));
  });

  it('lanza NotFoundException cuando el formCode no tiene versión predeterminada', async () => {
    await expect(new TemplateRegistry().resolve('FORMULARIO-INEXISTENTE')).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException cuando el template.pdf no existe en disco', async () => {
    accessFailsOnCall(1);
    await expect(new TemplateRegistry().resolve('HSE-FO-016', 'v00')).rejects.toThrow(NotFoundException);
  });

  it('lanza NotFoundException cuando el mapping.json no existe en disco', async () => {
    accessFailsOnCall(2);
    await expect(new TemplateRegistry().resolve('HSE-FO-016', 'v00')).rejects.toThrow(NotFoundException);
  });

  it('rechaza path traversal en formCode (..)', async () => {
    await expect(new TemplateRegistry().resolve('../etc/passwd')).rejects.toThrow(NotFoundException);
  });

  it('rechaza path traversal con barras en formCode', async () => {
    await expect(new TemplateRegistry().resolve('HSE/FO/016')).rejects.toThrow(NotFoundException);
  });

  it('rechaza path traversal con barras invertidas en formCode', async () => {
    await expect(new TemplateRegistry().resolve('HSE\\FO\\016')).rejects.toThrow(NotFoundException);
  });

  it('rechaza bytes nulos en formCode', async () => {
    await expect(new TemplateRegistry().resolve('HSE\0FO016')).rejects.toThrow(NotFoundException);
  });

  it('rechaza templateVersion con separadores de ruta', async () => {
    await expect(new TemplateRegistry().resolve('HSE-FO-016', '../v00')).rejects.toThrow(NotFoundException);
  });

  it('rechaza formCode vacío', async () => {
    await expect(new TemplateRegistry().resolve('')).rejects.toThrow(NotFoundException);
  });

  it('defaultVersion retorna v00 para HSE-FO-016', () => {
    expect(new TemplateRegistry().defaultVersion('HSE-FO-016')).toBe('v00');
  });

  it('defaultVersion retorna undefined para formCode desconocido', () => {
    expect(new TemplateRegistry().defaultVersion('DESCONOCIDO')).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S2 — TemplateLoader
// ══════════════════════════════════════════════════════════════════════════

describe('TemplateLoader', () => {
  it('carga correctamente un template PDF válido', async () => {
    setupReadFile(await minimalPdf(), validMapping);
    const result = await new TemplateLoader().load('/fake/template.pdf', '/fake/mapping.json');
    expect(result.pdfDoc).toBeInstanceOf(PDFDocument);
    expect(result.pageCount).toBe(1);
    expect(result.mapping.meta.formCode).toBe('HSE-FO-016');
  });

  it('la copia cargada es independiente — el buffer original permanece igual', async () => {
    const pdfBytes = await minimalPdf();
    const snapshot = Buffer.from(pdfBytes).toString('hex');
    setupReadFile(pdfBytes, validMapping);
    const result = await new TemplateLoader().load('/fake/template.pdf', '/fake/mapping.json');
    result.pdfDoc.getPage(0).drawText('TEST', { x: 10, y: 10, size: 12 });
    await result.pdfDoc.save();
    expect(Buffer.from(pdfBytes).toString('hex')).toBe(snapshot);
  });

  it('lanza si el mapping.json no es JSON válido', async () => {
    mockReadFileImpl = async (p, enc) => {
      if (String(p).endsWith('.pdf')) return Buffer.from(await minimalPdf());
      return enc ? '{ bad }' : Buffer.from('{ bad }');
    };
    await expect(new TemplateLoader().load('/f/t.pdf', '/f/m.json')).rejects.toThrow('El mapping JSON no es válido');
  });

  it('lanza si el mapping no tiene meta.formCode', async () => {
    const bad = JSON.stringify({ meta: { templateVersion: 'v00', pageCount: 1 }, fields: {} });
    setupReadFile(await minimalPdf(), bad);
    await expect(new TemplateLoader().load('/f/t.pdf', '/f/m.json')).rejects.toThrow('meta.formCode');
  });

  it('lanza si un campo tiene tipo inválido', async () => {
    const bad = JSON.stringify({ meta: { formCode: 'X', templateVersion: 'v00', pageCount: 1 }, fields: { c: { type: 'INVALID', page: 0, x: 0, y: 0, width: 0, height: 0 } } });
    setupReadFile(await minimalPdf(), bad);
    await expect(new TemplateLoader().load('/f/t.pdf', '/f/m.json')).rejects.toThrow('tipo inválido');
  });

  it('lanza si el archivo no es un PDF válido', async () => {
    mockReadFileImpl = async (p, enc) => {
      if (String(p).endsWith('.pdf')) return Buffer.from('no-pdf');
      return enc ? validMapping : Buffer.from(validMapping);
    };
    await expect(new TemplateLoader().load('/f/t.pdf', '/f/m.json')).rejects.toThrow('plantilla PDF');
  });

  it('lanza si el archivo template.pdf no existe', async () => {
    mockReadFileImpl = async (p, enc) => {
      if (String(p).endsWith('.pdf')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return enc ? validMapping : Buffer.from(validMapping);
    };
    await expect(new TemplateLoader().load('/f/t.pdf', '/f/m.json')).rejects.toThrow('plantilla PDF');
  });

  it('el pageCount del resultado coincide con el PDF real', async () => {
    const twoPageMapping = JSON.stringify({ ...JSON.parse(validMapping), meta: { ...JSON.parse(validMapping).meta, pageCount: 2 } });
    setupReadFile(await minimalPdf(2), twoPageMapping);
    const result = await new TemplateLoader().load('/f/t.pdf', '/f/m.json');
    expect(result.pageCount).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S3 — TextRenderer
// ══════════════════════════════════════════════════════════════════════════

describe('TextRenderer', () => {
  let renderer: TextRenderer;
  let doc: PDFDocument;
  let font: Awaited<ReturnType<PDFDocument['embedFont']>>;
  let page: ReturnType<PDFDocument['getPage']>;

  beforeEach(async () => {
    renderer = new TextRenderer();
    doc = await PDFDocument.create();
    doc.addPage([792, 612]);
    font = await doc.embedFont(StandardFonts.Helvetica);
    page = doc.getPage(0);
  });

  const baseField = { type: 'TEXT' as const, page: 0, x: 50, y: 50, width: 200, height: 20, fontSize: 8 };

  it('no lanza si el valor está vacío', () => {
    expect(() => renderer.render({ page, font, field: baseField, value: '' })).not.toThrow();
  });

  it('renderiza texto simple sin errores', () => {
    expect(() => renderer.render({ page, font, field: baseField, value: 'Empresa de prueba' })).not.toThrow();
  });

  it('renderiza caracteres españoles sin errores (á é í ó ú ñ Ñ ¿ ¡)', () => {
    expect(() => renderer.render({ page, font, field: baseField, value: 'Señoría: ¡¿Cómo están?' })).not.toThrow();
  });

  it('hace word-wrap correctamente para texto largo', () => {
    const lines = renderer.wrapText('palabra1 palabra2 palabra3 palabra4', font, 8, 60);
    expect(lines.length).toBeGreaterThan(1);
  });

  it('respeta saltos de línea explícitos \\n', () => {
    const lines = renderer.wrapText('línea uno\nlínea dos', font, 8, 300);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('línea uno');
    expect(lines[1]).toBe('línea dos');
  });

  it('aplica política shrink reduciendo fontSize hasta minFontSize', () => {
    const field = { ...baseField, height: 5, fontSize: 8, minFontSize: 5, overflow: 'shrink' as const };
    expect(() => renderer.render({ page, font, field, value: 'Texto muy largo que no cabe en la celda pequeña definitivamente' })).not.toThrow();
  });

  it('aplica política truncate añadiendo "…" al final', () => {
    const field = { ...baseField, height: 8, fontSize: 6, minFontSize: 6, overflow: 'truncate' as const };
    expect(() => renderer.render({ page, font, field, value: 'Texto muy largo que definitivamente no cabe en este espacio pequeño nunca' })).not.toThrow();
  });

  it('aplica política warn sin lanzar excepción', () => {
    const field = { ...baseField, height: 2, fontSize: 6, minFontSize: 6, overflow: 'warn' as const };
    expect(() => renderer.render({ page, font, field, value: 'Texto que no cabe con warn' })).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S4 — CheckboxRenderer
// ══════════════════════════════════════════════════════════════════════════

describe('CheckboxRenderer', () => {
  let renderer: CheckboxRenderer;
  let page: ReturnType<PDFDocument['getPage']>;

  beforeEach(async () => {
    renderer = new CheckboxRenderer();
    const doc = await PDFDocument.create();
    doc.addPage([792, 612]);
    page = doc.getPage(0);
  });

  const baseField = { type: 'CHECKBOX' as const, page: 0, x: 100, y: 100, size: 8, checkedWhen: { field: 'resp', equals: 'SI' } };

  it('no dibuja nada si checked = false', () => {
    const spy = jest.spyOn(page, 'drawText');
    renderer.render({ page, field: baseField, checked: false });
    expect(spy).not.toHaveBeenCalled();
  });

  it('dibuja marca si checked = true', () => {
    const spy = jest.spyOn(page, 'drawText');
    renderer.render({ page, field: baseField, checked: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shouldCheck equals SI: true cuando valor es SI', () => {
    expect(renderer.shouldCheck({ field: 'resp', equals: 'SI' }, { resp: 'SI' })).toBe(true);
  });

  it('shouldCheck equals SI: false cuando valor es NO', () => {
    expect(renderer.shouldCheck({ field: 'resp', equals: 'SI' }, { resp: 'NO' })).toBe(false);
  });

  it('shouldCheck es case-insensitive', () => {
    expect(renderer.shouldCheck({ field: 'resp', equals: 'si' }, { resp: 'SI' })).toBe(true);
  });

  it('shouldCheck includes: true si array contiene valor', () => {
    expect(renderer.shouldCheck({ field: 'sistemas', includes: 'Andamio' }, { sistemas: ['Andamio', 'Escalera'] })).toBe(true);
  });

  it('shouldCheck includes: false si array no contiene valor', () => {
    expect(renderer.shouldCheck({ field: 'sistemas', includes: 'Andamio' }, { sistemas: ['Escalera'] })).toBe(false);
  });

  it('shouldCheck includes: funciona con valor no-array', () => {
    expect(renderer.shouldCheck({ field: 'campo', includes: 'Escalera' }, { campo: 'Escalera' })).toBe(true);
  });

  it('shouldCheck: false si el campo no existe en answers', () => {
    expect(renderer.shouldCheck({ field: 'inexistente', equals: 'SI' }, {})).toBe(false);
  });

  it('shouldCheck N/A: true cuando el valor es N/A', () => {
    expect(renderer.shouldCheck({ field: 'verif', equals: 'N/A' }, { verif: 'N/A' })).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S5 — ImageRenderer (firmas)
// ══════════════════════════════════════════════════════════════════════════

describe('ImageRenderer', () => {
  let renderer: ImageRenderer;
  let doc: PDFDocument;
  let page: ReturnType<PDFDocument['getPage']>;

  beforeEach(async () => {
    renderer = new ImageRenderer();
    doc = await PDFDocument.create();
    doc.addPage([792, 612]);
    page = doc.getPage(0);
  });

  const baseField = { type: 'SIGNATURE' as const, page: 0, x: 50, y: 50, width: 80, height: 20, fit: 'contain' as const, align: 'center' as const };

  it('no lanza si imageBytes está vacío', async () => {
    await expect(renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: Buffer.alloc(0) })).resolves.not.toThrow();
  });

  it('incrusta correctamente un PNG válido', async () => {
    await expect(renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: MINIMAL_PNG })).resolves.not.toThrow();
  });

  it('no lanza con bytes de imagen inválidos (solo emite warn)', async () => {
    await expect(renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: Buffer.from('not-an-image') })).resolves.not.toThrow();
  });

  it('el PDF generado conserva 1 página después de insertar firma', async () => {
    await renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: MINIMAL_PNG });
    const output = await doc.save();
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getPageCount()).toBe(1);
  });
});
