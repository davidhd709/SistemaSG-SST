import { NotFoundException } from '@nestjs/common';
import * as path from 'node:path';

// ── Mocks de node:fs/promises ─────────────────────────────────────────────
let mockAccessImpl: (p: string) => Promise<void> = async () => {
  /* ok */
};
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
import { PNG } from 'pngjs';
import { TextRenderer } from './renderers/text.renderer';
import { CheckboxRenderer } from './renderers/checkbox.renderer';
import { ImageRenderer } from './renderers/image.renderer';
import { CrewTableRenderer } from './renderers/crew-table.renderer';
import { FieldRenderer } from './field-renderer';
import { PdfService } from './pdf.service';

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Genera en tiempo de ejecución un PNG RGBA válido (48x20) con fondo blanco
 * y un trazo oscuro de firma, verificable por pngjs y pdf-lib.
 */
function createValidSignaturePng(): Buffer {
  const png = new PNG({ width: 48, height: 20 });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (png.width * y + x) << 2;
      const isInkStroke = y >= 6 && y <= 13 && x >= 8 && x <= 39;
      png.data[idx] = isInkStroke ? 15 : 255;
      png.data[idx + 1] = isInkStroke ? 25 : 255;
      png.data[idx + 2] = isInkStroke ? 55 : 255;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

function accessAlwaysExists(): void {
  mockAccessImpl = async () => {
    /* ok */
  };
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
  meta: {
    formCode: 'HSE-FO-016',
    templateVersion: 'v00',
    pageCount: 1,
    pageSize: { width: 792, height: 612 },
    orientation: 'landscape',
  },
  fields: {
    empresa: { type: 'TEXT', page: 0, x: 100, y: 50, width: 150, height: 12, fontSize: 7 },
    sistemas_acceso_andamio: {
      type: 'CHECKBOX',
      page: 0,
      x: 200,
      y: 100,
      size: 6,
      checkedWhen: { field: 'sistemas_acceso', includes: 'Andamio' },
    },
  },
});

/** `validMapping` con las cinco filas firmables de cuadrilla de HSE-FO-016 v00. */
const crewMapping = JSON.stringify({
  ...(JSON.parse(validMapping) as Record<string, unknown>),
  fields: {
    ...(JSON.parse(validMapping) as { fields: Record<string, unknown> }).fields,
    ...Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `cuadrilla_0${i + 1}_firma`,
        { type: 'SIGNATURE', page: 0, x: 450, y: 300 + i * 10, width: 40, height: 8, memberIndex: i },
      ]),
    ),
  },
});

function setupReadFile(pdfBytes: Uint8Array, mappingJson: string): void {
  mockReadFileImpl = async (p: string, enc?: string) => {
    if (String(p).endsWith('.pdf')) return Buffer.from(pdfBytes);
    return enc ? mappingJson : Buffer.from(mappingJson);
  };
}

/** PNG RGBA válido generado con pngjs (contiene trazo de firma sobre fondo blanco). */
const MINIMAL_PNG = createValidSignaturePng();

// ══════════════════════════════════════════════════════════════════════════
// S2 — TemplateRegistry
// ══════════════════════════════════════════════════════════════════════════

describe('TemplateRegistry', () => {
  beforeEach(() => {
    accessAlwaysExists();
  });

  it('resuelve la versión predeterminada de HSE-FO-016', async () => {
    const result = await new TemplateRegistry().resolve('HSE-FO-016');
    expect(result.templatePath).toContain(path.join('HSE-FO-016', 'v00', 'template.pdf'));
    expect(result.mappingPath).toContain(path.join('HSE-FO-016', 'v00', 'mapping.json'));
  });

  it('resuelve las plantillas en backend/pdf-templates sin depender del directorio de trabajo (TEC-001)', async () => {
    const expectedRoot = path.resolve(__dirname, '..', '..', 'pdf-templates');
    const cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(path.resolve(__dirname, '..', '..', '..'));
    try {
      const result = await new TemplateRegistry().resolve('HSE-FO-016');
      expect(result.templatePath).toBe(path.join(expectedRoot, 'HSE-FO-016', 'v00', 'template.pdf'));
    } finally {
      cwdSpy.mockRestore();
    }
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
    const bad = JSON.stringify({
      meta: { formCode: 'X', templateVersion: 'v00', pageCount: 1 },
      fields: { c: { type: 'INVALID', page: 0, x: 0, y: 0, width: 0, height: 0 } },
    });
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
    const parsedMapping = JSON.parse(validMapping) as {
      meta: Record<string, unknown>;
      fields: Record<string, unknown>;
    };
    const twoPageMapping = JSON.stringify({
      ...parsedMapping,
      meta: { ...parsedMapping.meta, pageCount: 2 },
    });
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
    expect(() =>
      renderer.render({ page, font, field, value: 'Texto muy largo que no cabe en la celda pequeña definitivamente' }),
    ).not.toThrow();
  });

  it('aplica política truncate añadiendo "…" al final', () => {
    const field = { ...baseField, height: 8, fontSize: 6, minFontSize: 6, overflow: 'truncate' as const };
    expect(() =>
      renderer.render({
        page,
        font,
        field,
        value: 'Texto muy largo que definitivamente no cabe en este espacio pequeño nunca',
      }),
    ).not.toThrow();
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

  const baseField = {
    type: 'CHECKBOX' as const,
    page: 0,
    x: 100,
    y: 100,
    size: 8,
    checkedWhen: { field: 'resp', equals: 'SI' },
  };

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
    expect(
      renderer.shouldCheck({ field: 'sistemas', includes: 'Andamio' }, { sistemas: ['Andamio', 'Escalera'] }),
    ).toBe(true);
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

  const baseField = {
    type: 'SIGNATURE' as const,
    page: 0,
    x: 50,
    y: 50,
    width: 80,
    height: 20,
    fit: 'contain' as const,
    align: 'center' as const,
  };

  it('rechaza una firma vacía', async () => {
    await expect(renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: Buffer.alloc(0) })).rejects.toThrow(
      /vacía/,
    );
  });

  it('incrusta correctamente un PNG válido', async () => {
    await expect(
      renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: MINIMAL_PNG }),
    ).resolves.not.toThrow();
  });

  it('rechaza bytes de firma inválidos', async () => {
    await expect(
      renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: Buffer.from('not-an-image') }),
    ).rejects.toThrow(/Formato de imagen no reconocido/);
  });

  it('el PDF generado conserva 1 página después de insertar firma', async () => {
    await renderer.render({ page, pdfDoc: doc, field: baseField, imageBytes: MINIMAL_PNG });
    const output = await doc.save();
    const reloaded = await PDFDocument.load(output);
    expect(reloaded.getPageCount()).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S6 — FieldRenderer (AUD-001 protección de firmas)
// ══════════════════════════════════════════════════════════════════════════

describe('FieldRenderer — AUD-001 protección de firmas', () => {
  let textRenderer: TextRenderer;
  let checkboxRenderer: CheckboxRenderer;
  let imageRenderer: ImageRenderer;
  let crewTableRenderer: CrewTableRenderer;
  let fieldRenderer: FieldRenderer;
  let doc: PDFDocument;

  beforeEach(async () => {
    textRenderer = new TextRenderer();
    checkboxRenderer = new CheckboxRenderer();
    imageRenderer = new ImageRenderer();
    crewTableRenderer = new CrewTableRenderer(imageRenderer);
    fieldRenderer = new FieldRenderer(textRenderer, checkboxRenderer, imageRenderer, crewTableRenderer);
    doc = await PDFDocument.create();
    doc.addPage([612, 792]);
  });

  const signatureMapping = {
    meta: {
      formCode: 'HSE-FO-016',
      templateVersion: 'v00',
      pageCount: 1,
      pageSize: { width: 612, height: 792 },
      orientation: 'portrait' as const,
    },
    fields: {
      cuadrilla_01_firma: {
        type: 'SIGNATURE' as const,
        page: 0,
        x: 444.5,
        y: 666.3,
        width: 84,
        height: 10,
        fit: 'contain' as const,
        align: 'center' as const,
        memberIndex: 0,
      },
      autorizador_firma: {
        type: 'SIGNATURE' as const,
        page: 0,
        x: 382,
        y: 75.3,
        width: 146,
        height: 10,
        fit: 'contain' as const,
        align: 'center' as const,
        fieldKey: 'autorizador_firma',
      },
      coordinador_alturas_firma: {
        type: 'SIGNATURE' as const,
        page: 0,
        x: 382,
        y: 48.7,
        width: 146,
        height: 10,
        fit: 'contain' as const,
        align: 'center' as const,
        fieldKey: 'coordinador_alturas_firma',
      },
    },
  };

  it('impide insertar firmas mediante base64 o data:image/ desde answers cuando no hay firma autorizada', async () => {
    const spy = jest.spyOn(imageRenderer, 'render');
    const fakeDataUrl = `data:image/png;base64,${MINIMAL_PNG.toString('base64')}`;
    const fakeRawBase64 = MINIMAL_PNG.toString('base64').repeat(2);

    await fieldRenderer.render(doc, signatureMapping, {
      answers: {
        cuadrilla_01_firma: fakeDataUrl,
        autorizador_firma: fakeDataUrl,
        coordinador_alturas_firma: fakeRawBase64,
      },
      signatures: [],
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('conserva e incrusta las firmas legítimas resueltas desde almacenamiento autorizado', async () => {
    const spy = jest.spyOn(imageRenderer, 'render');
    const fakeDataUrl = `data:image/png;base64,${MINIMAL_PNG.toString('base64')}`;

    await fieldRenderer.render(doc, signatureMapping, {
      answers: {
        autorizador_firma: fakeDataUrl,
      },
      signatures: [
        {
          memberIndex: 0,
          imageBytes: MINIMAL_PNG,
        },
      ],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        imageBytes: MINIMAL_PNG,
      }),
    );
  });

  it('incrusta realmente en la página del PDF una firma PNG válida autorizada, invoca page.drawImage e ignora firmas falsas en answers', async () => {
    const validSignaturePng = createValidSignaturePng();
    const parsedPng = PNG.sync.read(validSignaturePng);
    expect(parsedPng.width).toBe(48);
    expect(parsedPng.height).toBe(20);

    const page = doc.getPage(0);
    const embedPngSpy = jest.spyOn(doc, 'embedPng');
    const drawImageSpy = jest.spyOn(page, 'drawImage');
    const fakeInjectedSignature = `data:image/png;base64,${validSignaturePng.toString('base64')}`;

    await fieldRenderer.render(doc, signatureMapping, {
      answers: {
        autorizador_firma: fakeInjectedSignature,
        coordinador_alturas_firma: fakeInjectedSignature,
      },
      signatures: [
        {
          memberIndex: 0,
          imageBytes: validSignaturePng,
        },
      ],
    });

    // Se embebe y dibuja únicamente la firma autorizada (1 vez), ignorando las 2 falsas en answers
    expect(embedPngSpy).toHaveBeenCalledTimes(1);
    expect(drawImageSpy).toHaveBeenCalledTimes(1);

    const savedBytes = await doc.save();
    const rawPdfContent = Buffer.from(savedBytes).toString('latin1');
    expect(rawPdfContent).toContain('/Subtype /Image');

    const reloadedDoc = await PDFDocument.load(savedBytes);
    expect(reloadedDoc.getPageCount()).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// S7 — PdfService (AUD-001 integridad de cuadrilla y registros históricos)
// ══════════════════════════════════════════════════════════════════════════

describe('PdfService — AUD-001 integridad de datos y firmas', () => {
  beforeEach(() => {
    accessAlwaysExists();
  });

  function createPdfServiceContext(submissionOverride?: Record<string, unknown>) {
    const baseSubmission = {
      id: 'sub-aud001',
      workDate: new Date('2026-04-16T00:00:00.000Z'),
      submittedAt: new Date('2026-04-16T13:00:00.000Z'),
      startedAt: new Date('2026-04-16T13:30:00.000Z'),
      closedAt: new Date('2026-04-16T22:00:00.000Z'),
      finalPdfFile: null,
      approval: {
        id: 'app-1',
        decision: 'APPROVED',
        decidedById: 'user-coord-1',
        decidedBy: { id: 'user-coord-1', email: 'coord@sgsst.local' },
      },
      collaborator: {
        id: 'collab-1',
        firstName: 'Carlos',
        lastName: 'Pérez',
        documentNumber: '1020304050',
        jobTitle: 'Oficial Eléctrico',
      },
      formVersion: {
        id: 'fv-1',
        versionNumber: 1,
        form: { code: 'HSE-FO-016', name: 'Permiso de trabajo en altura' },
        schemaJson: {
          fields: [
            { id: 'empresa', type: 'select' },
            { id: 'lugar_trabajo', type: 'text' },
            { id: 'fecha_trabajo', type: 'auto', source: 'workDate' },
            { id: 'hora_inicio', type: 'auto', source: 'startedAt' },
            { id: 'hora_finalizacion', type: 'auto', source: 'closedAt' },
            { id: 'certificado_alturas', type: 'auto', source: 'heightCertificate' },
            { id: 'seguridad_social_verificada', type: 'auto', source: 'socialSecurity' },
          ],
        },
      },
      members: [
        {
          id: 'mem-1',
          isLead: true,
          collaborator: {
            id: 'collab-1',
            firstName: 'Carlos',
            lastName: 'Pérez',
            documentNumber: '1020304050',
            jobTitle: 'Oficial Eléctrico',
          },
          jobPosition: { id: 'jp-1', name: 'Liniero Líder' },
          signature: {
            id: 'sig-1',
            file: { id: 'file-sig-1', objectKey: 'signatures/member-1.png' },
          },
        },
      ],
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        lugar_trabajo: 'Subestación Norte',
        fecha_trabajo: '2026-04-16',
        hora_inicio: '08:30 a. m.',
        hora_finalizacion: '05:00 p. m.',
        certificado_alturas: 'Vigente y verificado',
        seguridad_social_verificada: 'Vigente y verificado',
      },
      ...submissionOverride,
    };

    const tx = {
      fileObject: { create: jest.fn().mockResolvedValue({ id: 'pdf-file-id-1' }) },
      formSubmission: { update: jest.fn().mockResolvedValue({}) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };

    const prisma = {
      formSubmission: { findUnique: jest.fn().mockResolvedValue(baseSubmission) },
      $transaction: jest.fn((cb: (client: typeof tx) => Promise<unknown>) => cb(tx)),
    };

    const storage = {
      getObject: jest.fn().mockResolvedValue(MINIMAL_PNG),
      putObject: jest.fn().mockResolvedValue({
        storageProvider: 'LOCAL',
        bucket: 'local',
        objectKey: 'pdf/sub-aud001.pdf',
        sizeBytes: 1024,
        sha256: 'pdf-sha-256',
      }),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const templateRegistry = new TemplateRegistry();
    const templateLoader = new TemplateLoader();
    const textRenderer = new TextRenderer();
    const checkboxRenderer = new CheckboxRenderer();
    const imageRenderer = new ImageRenderer();
    const crewTableRenderer = new CrewTableRenderer(imageRenderer);
    const fieldRenderer = new FieldRenderer(textRenderer, checkboxRenderer, imageRenderer, crewTableRenderer);

    const pdfService = new PdfService(
      prisma as never,
      storage as never,
      templateRegistry,
      templateLoader,
      fieldRenderer,
    );

    return { pdfService, prisma, tx, storage, fieldRenderer, imageRenderer };
  }

  it('protege identidades, cargos y firmas al generar PDF desde registros históricos manipulados', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    const fakeSig = `data:image/png;base64,${MINIMAL_PNG.toString('base64')}`;
    const { pdfService, fieldRenderer } = createPdfServiceContext({
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        lugar_trabajo: 'Subestación Norte',
        certificado_alturas: 'Vigente y verificado',
        seguridad_social_verificada: 'Vigente y verificado',
        // Datos manipulados en registro histórico:
        cuadrilla_01_cedula: '999999999',
        cuadrilla_01_nombre: 'Impostor Uno',
        cuadrilla_01_cargo: 'Gerente Falso',
        cuadrilla_01_certificado: 'Falsificado',
        cuadrilla_01_seg_social: 'Falsificada',
        ejecutor_01_cedula: '999999999',
        ejecutor_01_nombre: 'Impostor Uno',
        ejecutor_01_cargo: 'Gerente Falso',
        cuadrilla_02_cedula: '888888888',
        cuadrilla_02_nombre: 'Intruso Inexistente',
        cuadrilla_02_cargo: 'Cargo Inexistente',
        autorizador_firma: fakeSig,
        firma_autorizador: fakeSig,
        coordinador_alturas_firma: fakeSig,
        hora_fin: '11:59 p.m.',
        campo_inyectado: 'malicioso',
      },
    });

    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    const fileId = await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');
    expect(fileId).toBe('pdf-file-id-1');
    expect(renderSpy).toHaveBeenCalledTimes(1);

    const renderData = renderSpy.mock.calls[0][2];
    expect(renderData.answers.cuadrilla_01_cedula).toBe('1020304050');
    expect(renderData.answers.cuadrilla_01_nombre).toBe('Carlos Pérez');
    expect(renderData.answers.cuadrilla_01_cargo).toBe('Liniero Líder');
    // Sin complianceJson en el integrante: el "Vigente" de answersJson no se usa (AUD-002).
    expect(renderData.answers.cuadrilla_01_certificado).toBe('Sin registro');
    expect(renderData.answers.cuadrilla_01_seg_social).toBe('Sin registro');
    expect(renderData.answers.ejecutor_01_cedula).toBe('1020304050');
    expect(renderData.answers.ejecutor_01_nombre).toBe('Carlos Pérez');
    expect(renderData.answers.ejecutor_01_cargo).toBe('Liniero Líder');

    // No deben filtrarse filas falsas ni firmas inyectadas ni campos no autorizados
    expect(renderData.answers.cuadrilla_02_cedula).toBeUndefined();
    expect(renderData.answers.cuadrilla_02_nombre).toBeUndefined();
    expect(renderData.answers.autorizador_firma).toBeUndefined();
    expect(renderData.answers.firma_autorizador).toBeUndefined();
    expect(renderData.answers.coordinador_alturas_firma).toBeUndefined();
    expect(renderData.answers.campo_inyectado).toBeUndefined();
    expect(renderData.answers.hora_fin).not.toBe('11:59 p.m.');
  });

  it('genera un permiso PDF válido cuando los datos son correctos y conserva las firmas legítimas', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    const { pdfService, storage, tx, fieldRenderer } = createPdfServiceContext();
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    const fileId = await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    expect(fileId).toBe('pdf-file-id-1');
    expect(storage.getObject).toHaveBeenCalledWith('signatures/member-1.png');
    expect(renderSpy).toHaveBeenCalledTimes(1);
    const renderData = renderSpy.mock.calls[0][2];
    expect(renderData.answers).toMatchObject({
      empresa: 'OPAINN ESP SAS',
      lugar_trabajo: 'Subestación Norte',
      cuadrilla_01_cedula: '1020304050',
      cuadrilla_01_nombre: 'Carlos Pérez',
      cuadrilla_01_cargo: 'Liniero Líder',
    });
    expect(renderData.signatures).toEqual([{ memberIndex: 0, imageBytes: MINIMAL_PNG }]);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'application/pdf',
      }),
    );
    expect(tx.formSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-aud001' },
      data: { finalPdfFileId: 'pdf-file-id-1' },
    });
    const auditCall = tx.auditEvent.create.mock.calls[0][0] as {
      data: { action: string; entityId: string };
    };
    expect(auditCall.data).toMatchObject({
      action: 'GENERATE_FINAL_PDF',
      entityId: 'sub-aud001',
    });
  });

  it('ignora fecha_trabajo y vigencia_permiso manipuladas en registros históricos y usa la fecha autorizada del servidor', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    const authoritativeDate = new Date('2026-04-16T00:00:00.000Z');
    const expectedFormattedDate = '16/04/2026';

    const { pdfService, fieldRenderer } = createPdfServiceContext({
      workDate: authoritativeDate,
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        lugar_trabajo: 'Subestación Norte',
        fecha_trabajo: '31/12/2099',
        vigencia_permiso: '31/12/2099',
      },
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    const renderData = renderSpy.mock.calls[0][2];
    expect(renderData.answers.fecha_trabajo).toBe(expectedFormattedDate);
    expect(renderData.answers.vigencia_permiso).toBe(expectedFormattedDate);
    expect(renderData.answers.fecha_trabajo).not.toBe('31/12/2099');
  });

  it.each(['UTC', 'America/Bogota', 'Asia/Tokyo'])(
    'formatea fecha y horas en hora de Colombia aunque el proceso corra en %s (AUD-003)',
    async (tz) => {
      const previousTz = process.env.TZ;
      process.env.TZ = tz;
      try {
        const pdfBytes = await minimalPdf(1);
        setupReadFile(pdfBytes, crewMapping);
        const { pdfService, fieldRenderer } = createPdfServiceContext({
          workDate: new Date('2026-04-16T00:00:00.000Z'),
          // 19:10 y 23:50 en Colombia: frontera en la que UTC ya está en el día siguiente.
          startedAt: new Date('2026-04-17T00:10:00.000Z'),
          closedAt: new Date('2026-04-17T04:50:00.000Z'),
        });
        const renderSpy = jest.spyOn(fieldRenderer, 'render');

        await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

        const { answers } = renderSpy.mock.calls[0][2];
        expect(answers.fecha_trabajo).toBe('16/04/2026');
        expect(answers.vigencia_permiso).toBe('16/04/2026');
        expect(answers.hora_inicio).toBe('07:10 p.m.');
        expect(answers.hora_fin).toBe('11:50 p.m.');
        expect(answers.hora_finalizacion).toBe('11:50 p.m.');
      } finally {
        if (previousTz === undefined) delete process.env.TZ;
        else process.env.TZ = previousTz;
      }
    },
  );

  it('usa submittedAt en hora de Colombia cuando no hay workDate (AUD-003)', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);
    const { pdfService, fieldRenderer } = createPdfServiceContext({
      workDate: null,
      // 21:00 del 16 en Colombia; en UTC ya es el 17.
      submittedAt: new Date('2026-04-17T02:00:00.000Z'),
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    expect(renderSpy.mock.calls[0][2].answers.fecha_trabajo).toBe('16/04/2026');
  });

  it('ignora hora_inicio manipulada en registros históricos y usa startedAt autorizado o vacío si no ha iniciado', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    // 13:30 UTC son las 08:30 en Colombia (UTC-5).
    const authoritativeStart = new Date('2026-04-16T13:30:00.000Z');
    const expectedStart = '08:30 a.m.';

    const { pdfService, fieldRenderer } = createPdfServiceContext({
      startedAt: authoritativeStart,
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        hora_inicio: '01:00 a.m.',
      },
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');
    expect(renderSpy.mock.calls[0][2].answers.hora_inicio).toBe(expectedStart);
    expect(renderSpy.mock.calls[0][2].answers.hora_inicio).not.toBe('01:00 a.m.');

    // Caso sin startedAt (ej. permiso rechazado antes de abrir jornada)
    const { pdfService: pdfServiceNoStart, fieldRenderer: rendererNoStart } = createPdfServiceContext({
      startedAt: null,
      closedAt: null,
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        hora_inicio: '06:00 a.m.',
        hora_finalizacion: '05:00 p.m.',
        hora_fin: '05:00 p.m.',
      },
    });
    const spyNoStart = jest.spyOn(rendererNoStart, 'render');
    await pdfServiceNoStart.generateFinalPdf('sub-aud001', 'user-coord-1');
    expect(spyNoStart.mock.calls[0][2].answers.hora_inicio).toBeUndefined();
    expect(spyNoStart.mock.calls[0][2].answers.hora_finalizacion).toBeUndefined();
    expect(spyNoStart.mock.calls[0][2].answers.hora_fin).toBeUndefined();
  });

  it('nunca confía en campos automáticos por estar en answersJson ni sustituye cumplimiento con Vigente o Verificada', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    const { pdfService, fieldRenderer } = createPdfServiceContext({
      workDate: null,
      submittedAt: null,
      startedAt: null,
      closedAt: null,
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        fecha_trabajo: '2099-01-01',
        vigencia_permiso: '2099-01-01',
        hora_inicio: '08:00',
        hora_finalizacion: '17:00',
        hora_fin: '17:00',
        certificado_alturas: 'Vigente y verificado',
        seguridad_social_verificada: 'Vigente y verificado',
      },
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    const { answers } = renderSpy.mock.calls[0][2];
    expect(answers.fecha_trabajo).toBeUndefined();
    expect(answers.vigencia_permiso).toBeUndefined();
    expect(answers.hora_inicio).toBeUndefined();
    expect(answers.hora_finalizacion).toBeUndefined();
    expect(answers.hora_fin).toBeUndefined();
    expect(answers.certificado_alturas).toBeUndefined();
    expect(answers.seguridad_social_verificada).toBeUndefined();
    // El integrante no tiene complianceJson: answersJson dice "Vigente" y no se le cree.
    expect(answers.cuadrilla_01_certificado).toBe('Sin registro');
    expect(answers.cuadrilla_01_seg_social).toBe('Sin registro');
    expect(answers.ejecutor_01_certificado).toBe('Sin registro');
    expect(answers.ejecutor_01_seg_social).toBe('Sin registro');
  });

  it('muestra por integrante los estados de cumplimiento guardados en complianceJson (AUD-002)', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);
    const integrante = (id: string, complianceJson: unknown) => ({
      id: `mem-${id}`,
      isLead: id === '1',
      collaborator: {
        id: `collab-${id}`,
        firstName: 'Persona',
        lastName: id,
        documentNumber: `10000${id}`,
        jobTitle: null,
      },
      jobPosition: null,
      complianceJson,
      signature: { id: `sig-${id}`, file: { id: `file-sig-${id}`, objectKey: `signatures/member-${id}.png` } },
    });
    const { pdfService, fieldRenderer } = createPdfServiceContext({
      members: [
        integrante('1', { alturas: { estado: 'VIGENTE' }, seguridadSocial: { estado: 'PROXIMA_A_VENCER' } }),
        integrante('2', { alturas: { estado: 'NO_APLICA' }, seguridadSocial: { estado: 'VIGENTE' } }),
        integrante('3', { alturas: { estado: 'VENCIDA' }, seguridadSocial: { estado: 'OTRO' } }),
      ],
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    const { answers } = renderSpy.mock.calls[0][2];
    expect(answers.cuadrilla_01_certificado).toBe('Vigente');
    expect(answers.cuadrilla_01_seg_social).toBe('Vigente (por vencer)');
    expect(answers.cuadrilla_02_certificado).toBe('No aplica');
    expect(answers.cuadrilla_02_seg_social).toBe('Vigente');
    expect(answers.cuadrilla_03_certificado).toBe('No vigente');
    expect(answers.cuadrilla_03_seg_social).toBe('Sin registro');
  });

  it('rechaza generar el PDF si la cuadrilla supera las filas de la plantilla y no guarda nada (TEC-008)', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);
    const members = Array.from({ length: 6 }, (_, i) => ({
      id: `mem-${i}`,
      isLead: i === 0,
      collaborator: {
        id: `collab-${i}`,
        firstName: 'Persona',
        lastName: `${i}`,
        documentNumber: `2000${i}`,
        jobTitle: null,
      },
      jobPosition: null,
      complianceJson: {},
      signature: null,
    }));
    const { pdfService, storage } = createPdfServiceContext({ members });

    await expect(pdfService.generateFinalPdf('sub-aud001', 'user-coord-1')).rejects.toThrow(
      /6 integrantes.*solo admite 5/,
    );
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('no guarda el PDF si falta la firma de un integrante (AUD-024)', async () => {
    setupReadFile(await minimalPdf(1), crewMapping);
    const { pdfService, storage, prisma } = createPdfServiceContext({
      members: [
        {
          id: 'mem-sin-firma',
          isLead: true,
          collaborator: { id: 'collab-1', firstName: 'Ana', lastName: 'Pérez', documentNumber: '123', jobTitle: null },
          jobPosition: null,
          complianceJson: {},
          signature: null,
        },
      ],
    });

    await expect(pdfService.generateFinalPdf('sub-aud001', 'user-coord-1')).rejects.toThrow(/Falta la firma/);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no guarda el PDF si falla la lectura de la firma (AUD-024)', async () => {
    setupReadFile(await minimalPdf(1), crewMapping);
    const { pdfService, storage, prisma } = createPdfServiceContext();
    storage.getObject.mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(pdfService.generateFinalPdf('sub-aud001', 'user-coord-1')).rejects.toThrow(
      /No se pudo cargar la firma/,
    );
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no guarda el PDF si una firma no se puede incrustar (AUD-024)', async () => {
    setupReadFile(await minimalPdf(1), crewMapping);
    const { pdfService, storage, prisma } = createPdfServiceContext();
    storage.getObject.mockResolvedValueOnce(Buffer.from('not-an-image'));

    await expect(pdfService.generateFinalPdf('sub-aud001', 'user-coord-1')).rejects.toThrow(
      /Formato de imagen no reconocido/,
    );
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('no guarda el PDF si falla el renderizado de un campo (AUD-024)', async () => {
    setupReadFile(await minimalPdf(1), crewMapping);
    const { pdfService, fieldRenderer, storage, prisma } = createPdfServiceContext();
    jest.spyOn(fieldRenderer, 'render').mockRejectedValueOnce(new Error('campo ilegible'));

    await expect(pdfService.generateFinalPdf('sub-aud001', 'user-coord-1')).rejects.toThrow('campo ilegible');
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('aplica lista blanca segura cuando schemaJson es inválido o incompleto, conservando campos legítimos y bloqueando no verificados', async () => {
    const pdfBytes = await minimalPdf(1);
    setupReadFile(pdfBytes, crewMapping);

    const { pdfService, fieldRenderer } = createPdfServiceContext({
      formVersion: {
        id: 'fv-empty',
        versionNumber: 1,
        form: { code: 'HSE-FO-016', name: 'Permiso de trabajo en altura' },
        schemaJson: { fields: [] },
      },
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        lugar_trabajo: 'Subestación Sur',
        sistemas_acceso: ['Andamio'],
        campo_no_verificado: 'inyeccion',
        objeto_invalido: { nested: true },
        cuadrilla_01_cedula: '000000',
        autorizador_firma: `data:image/png;base64,${MINIMAL_PNG.toString('base64')}`,
      },
    });
    const renderSpy = jest.spyOn(fieldRenderer, 'render');

    await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');

    const { answers } = renderSpy.mock.calls[0][2];
    expect(answers.empresa).toBe('OPAINN ESP SAS');
    expect(answers.lugar_trabajo).toBe('Subestación Sur');
    expect(answers.sistemas_acceso).toEqual(['Andamio']);
    expect(answers.campo_no_verificado).toBeUndefined();
    expect(answers.objeto_invalido).toBeUndefined();
    expect(answers.autorizador_firma).toBeUndefined();
    expect(answers.cuadrilla_01_cedula).toBe('1020304050');
  });

  it('incrusta de extremo a extremo la firma PNG válida del integrante en el PDF final, ignora firmas falsas de answersJson y permite reabrir el documento', async () => {
    const pdfBytes = await minimalPdf(1);
    const mappingWithSignatures = JSON.stringify({
      meta: {
        formCode: 'HSE-FO-016',
        templateVersion: 'v00',
        pageCount: 1,
        pageSize: { width: 792, height: 612 },
        orientation: 'landscape',
      },
      fields: {
        empresa: { type: 'TEXT', page: 0, x: 100, y: 50, width: 150, height: 12, fontSize: 7 },
        cuadrilla_01_cedula: { type: 'TEXT', page: 0, x: 60, y: 669, width: 66, height: 6, fontSize: 5 },
        cuadrilla_01_firma: {
          type: 'SIGNATURE',
          page: 0,
          x: 444.5,
          y: 500,
          width: 84,
          height: 15,
          fit: 'contain',
          align: 'center',
          memberIndex: 0,
        },
        autorizador_firma: {
          type: 'SIGNATURE',
          page: 0,
          x: 382,
          y: 75.3,
          width: 146,
          height: 12,
          fit: 'contain',
          align: 'center',
          fieldKey: 'autorizador_firma',
        },
      },
    });
    setupReadFile(pdfBytes, mappingWithSignatures);

    const validSignaturePng = createValidSignaturePng();
    const fakeAuthorizerSig = `data:image/png;base64,${validSignaturePng.toString('base64')}`;

    const { pdfService, storage } = createPdfServiceContext({
      answersJson: {
        empresa: 'OPAINN ESP SAS',
        autorizador_firma: fakeAuthorizerSig,
        coordinador_alturas_firma: fakeAuthorizerSig,
      },
    });
    storage.getObject.mockResolvedValue(validSignaturePng);

    const embedPngSpy = jest.spyOn(PDFDocument.prototype, 'embedPng');

    const fileId = await pdfService.generateFinalPdf('sub-aud001', 'user-coord-1');
    expect(fileId).toBe('pdf-file-id-1');

    // Solo debe embeber la firma legítima del integrante (memberIndex: 0) y no las firmas falsas de answersJson
    expect(embedPngSpy).toHaveBeenCalledTimes(1);

    const putCallArg = storage.putObject.mock.calls[0][0] as { body: Buffer; mimeType: string };
    expect(putCallArg.mimeType).toBe('application/pdf');
    expect(putCallArg.body.toString('latin1')).toContain('/Subtype /Image');

    const reloadedPdf = await PDFDocument.load(putCallArg.body);
    expect(reloadedPdf.getPageCount()).toBe(1);

    embedPngSpy.mockRestore();
  });
});
