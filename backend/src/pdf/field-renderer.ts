import { Injectable, Logger } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts } from 'pdf-lib';
import type { TemplateMapping, MappingField, TextField, CheckboxField, SignatureField } from './template-loader';
import { TextRenderer } from './renderers/text.renderer';
import { CheckboxRenderer } from './renderers/checkbox.renderer';
import { ImageRenderer } from './renderers/image.renderer';
import { CrewTableRenderer, CrewMemberRow, CrewTableConfig } from './renderers/crew-table.renderer';

/**
 * Firma resuelta lista para incrustar en el PDF.
 */
export interface ResolvedSignature {
  /** Índice del integrante de cuadrilla (0-based, igual que memberIndex en mapping). */
  memberIndex: number;
  imageBytes: Buffer;
}

/**
 * Datos dinámicos completos que recibe el FieldRenderer para superponer
 * sobre la plantilla oficial.
 */
export interface RenderData {
  /** Respuestas del formulario (answersJson). */
  answers: Record<string, unknown>;
  /** Firmas resueltas de los integrantes de cuadrilla. */
  signatures: ResolvedSignature[];
  /** Integrantes opcionales de cuadrilla para renderizado dinámico con CREW_TABLE. */
  members?: CrewMemberRow[];
}

/**
 * Orquesta el renderizado de todos los campos del mapping sobre el PDFDocument
 * cargado desde la plantilla oficial.
 *
 * Responsabilidades:
 * - Cargar la fuente una sola vez y reutilizarla.
 * - Iterar el mapping y delegar a cada renderer especializado.
 * - No conocer el dominio del negocio; solo renderiza lo que recibe.
 * - Registrar advertencias de campos no renderizables sin interrumpir.
 */
@Injectable()
export class FieldRenderer {
  private readonly logger = new Logger(FieldRenderer.name);

  constructor(
    private readonly textRenderer: TextRenderer,
    private readonly checkboxRenderer: CheckboxRenderer,
    private readonly imageRenderer: ImageRenderer,
    private readonly crewTableRenderer: CrewTableRenderer,
  ) {}

  /**
   * Superpone todos los campos del mapping sobre el pdfDoc.
   * El pdfDoc ya es una copia en memoria; la plantilla original no se toca.
   */
  async render(pdfDoc: PDFDocument, mapping: TemplateMapping, data: RenderData): Promise<void> {
    // Cargamos Helvetica una sola vez. Soporta caracteres latinos con pdf-lib
    // mediante su tabla de glifos estándar (cubre á, é, í, ó, ú, ñ, Ñ, ¿, ¡).
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const [fieldKey, field] of Object.entries(mapping.fields)) {
      const page = pages[field.page];
      if (!page) {
        this.logger.warn(`El campo "${fieldKey}" referencia la página ${field.page} que no existe en el PDF.`);
        continue;
      }

      try {
        await this.renderField(fieldKey, field, page, pdfDoc, font, data);
      } catch (error) {
        // Un campo fallido no debe detener la generación del documento completo.
        this.logger.error(`Error al renderizar campo "${fieldKey}": ${String(error)}`);
      }
    }
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  private async renderField(
    key: string,
    field: MappingField,
    page: PDFPage,
    pdfDoc: PDFDocument,
    font: PDFFont,
    data: RenderData,
  ): Promise<void> {
    switch (field.type) {
      case 'TEXT':
      case 'MULTILINE_TEXT':
      case 'NUMBER':
      case 'DATE':
      case 'TIME': {
        const value = this.resolveTextValue(key, data.answers);
        this.textRenderer.render({ page, font, field: field as TextField, value });
        break;
      }

      case 'CHECKBOX': {
        const cbField = field as CheckboxField;
        const checked = this.checkboxRenderer.shouldCheck(cbField.checkedWhen, data.answers);
        this.checkboxRenderer.render({ page, field: cbField, checked });
        break;
      }

      case 'SIGNATURE': {
        const sigField = field as SignatureField;
        const memberIndex = sigField.memberIndex ?? 0;
        const resolved = data.signatures.find((s) => s.memberIndex === memberIndex);
        if (resolved?.imageBytes) {
          await this.imageRenderer.render({ page, pdfDoc, field: sigField, imageBytes: resolved.imageBytes });
        }
        break;
      }

      case 'IMAGE': {
        // Imágenes estáticas: no aplica para HSE-FO-016 aún.
        this.logger.debug(`Campo IMAGE "${key}" ignorado (no implementado para este formulario).`);
        break;
      }

      case 'CREW_TABLE': {
        // Solo renderizar mediante CREW_TABLE si no se proveyeron filas individuales en answers
        const hasIndividualRows = Boolean(data.answers['cuadrilla_01_cedula'] || data.answers['ejecutor_01_cedula']);
        if (!hasIndividualRows && data.members && data.members.length > 0) {
          await this.crewTableRenderer.render(
            page,
            pdfDoc,
            font,
            field as unknown as CrewTableConfig,
            data.members,
          );
        }
        break;
      }
    }
  }

  /**
   * Resuelve el valor de texto de un campo a partir de las respuestas.
   * Los arrays se unen con coma. Los valores nulos/vacíos retornan ''.
   */
  private resolveTextValue(key: string, answers: Record<string, unknown>): string {
    const raw = answers[key];
    if (raw === null || raw === undefined || raw === '') return '';
    if (Array.isArray(raw)) return raw.map((v) => String(v ?? '')).filter(Boolean).join(', ');
    return String(raw);
  }
}
