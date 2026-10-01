import { Injectable, Logger } from '@nestjs/common';
import { PDFPage, PDFFont, rgb } from 'pdf-lib';
import type { TextField, FieldAlign, OverflowPolicy } from '../template-loader';

export interface RenderTextOptions {
  page: PDFPage;
  font: PDFFont;
  field: TextField;
  value: string;
}

/**
 * Renderiza texto (TEXT, MULTILINE_TEXT, NUMBER, DATE, TIME) sobre una página
 * del PDF oficial sin modificar el contenido original de la plantilla.
 *
 * Estrategia de ajuste (overflow = 'shrink' por defecto):
 *   1. Intenta con fontSize inicial y word-wrap dentro de `width`.
 *   2. Si el texto desborda `height`, reduce fontSize de uno en uno.
 *   3. Si llega a minFontSize y aún desborda, aplica la política de overflow:
 *      - 'shrink'   → deja el texto en minFontSize (puede salir de la celda;
 *                     emite WARNING para auditoría).
 *      - 'truncate' → corta el texto con "…" para que entre en minFontSize.
 *      - 'warn'     → no renderiza nada y emite ERROR para que sea revisado.
 */
@Injectable()
export class TextRenderer {
  private readonly logger = new Logger(TextRenderer.name);

  render({ page, font, field, value }: RenderTextOptions): void {
    if (!value || value === '—') {
      // Valor vacío: no renderizar nada sobre la plantilla.
      return;
    }

    const {
      x,
      y,
      width,
      height,
      fontSize: initialFontSize,
      minFontSize = 5,
      maxLines,
      align = 'left',
      overflow = 'shrink',
    } = field;

    // pdf-lib usa coordenadas desde la esquina inferior-izquierda (origen Y=0 en fondo).
    // Si el campo tiene origin: 'top-left', se convierte: y_pdf = pageHeight - y_mapping - height.
    // De lo contrario, se asume el sistema nativo de pdf-lib (bottom-left): baseY = y.
    const pageHeight = page.getHeight();
    const isTopLeft = (field as { origin?: string }).origin === 'top-left';
    const baseY = isTopLeft ? pageHeight - y - height : y;

    let currentFontSize = initialFontSize;
    let lines: string[] = [];
    let fits = false;

    while (currentFontSize >= minFontSize) {
      lines = this.wrapText(value, font, currentFontSize, width);
      if (maxLines !== undefined) lines = lines.slice(0, maxLines);
      const totalTextHeight = lines.length === 1 ? currentFontSize : lines.length * currentFontSize * 1.2;
      if (totalTextHeight <= height) {
        fits = true;
        break;
      }
      currentFontSize--;
    }

    if (!fits) {
      switch (overflow) {
        case 'truncate': {
          lines = this.truncateToFit(value, font, minFontSize, width, height);
          currentFontSize = minFontSize;
          break;
        }
        case 'warn': {
          this.logger.error(
            `El texto del campo (x=${x}, y=${y}) no cabe en la celda con minFontSize=${minFontSize}. ` +
              `No se renderizará. Valor: "${value.slice(0, 80)}..."`,
          );
          return;
        }
        default: {
          // 'shrink': renderiza en minFontSize aunque desborde y advierte.
          currentFontSize = minFontSize;
          this.logger.warn(
            `El texto del campo (x=${x}, y=${y}) desbordó la celda incluso con fontSize=${minFontSize}. ` +
              `Se renderizará de todas formas. Considere ampliar la celda o reducir el texto.`,
          );
        }
      }
    }

    const leading = currentFontSize * 1.2;
    if (lines.length === 1) {
      // Línea única: centrado vertical en la celda con padding mínimo
      const lineY = baseY + Math.max(0.5, (height - currentFontSize) / 2);
      const lineX = this.computeX(lines[0], font, currentFontSize, x, width, align);
      page.drawText(lines[0], {
        x: lineX,
        y: lineY,
        size: currentFontSize,
        font,
        color: rgb(0, 0, 0),
      });
    } else {
      // Multilínea: desde la parte superior de la celda hacia abajo
      const topY = baseY + height - currentFontSize;
      for (let i = 0; i < lines.length; i++) {
        const lineY = topY - i * leading;
        if (lineY < baseY - leading) break;
        const lineX = this.computeX(lines[i], font, currentFontSize, x, width, align);
        page.drawText(lines[i], {
          x: lineX,
          y: lineY,
          size: currentFontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  // ── Privados ──────────────────────────────────────────────────────────────

  /**
   * Divide el texto en líneas que caben dentro de `maxWidth` usando word-wrap.
   * Respeta saltos de línea explícitos (\n).
   */
  wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
    const result: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        result.push('');
        continue;
      }
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        const candidateWidth = font.widthOfTextAtSize(candidate, fontSize);

        if (candidateWidth <= maxWidth) {
          currentLine = candidate;
        } else {
          if (currentLine) result.push(currentLine);
          // Si una sola palabra es más ancha que la celda, se fuerza igualmente.
          currentLine = word;
        }
      }
      if (currentLine) result.push(currentLine);
    }

    return result;
  }

  /**
   * Trunca el texto para que quepa en la celda con la fuente más pequeña,
   * añadiendo "…" al final si fue necesario recortar.
   */
  private truncateToFit(
    text: string,
    font: PDFFont,
    fontSize: number,
    maxWidth: number,
    maxHeight: number,
  ): string[] {
    const maxLinesCount = Math.max(1, Math.floor(maxHeight / (fontSize * 1.2)));
    const lines = this.wrapText(text, font, fontSize, maxWidth).slice(0, maxLinesCount);

    if (lines.length === 0) return [];

    // Si el último bloque de líneas aún es el texto completo, no truncar.
    const joined = lines.join(' ');
    if (joined === text.trim()) return lines;

    // Añadir "…" al final de la última línea.
    const lastLine = lines[lines.length - 1];
    const ellipsis = '…';
    let shortened = lastLine;
    while (shortened.length > 0) {
      const candidate = shortened + ellipsis;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        lines[lines.length - 1] = candidate;
        break;
      }
      shortened = shortened.slice(0, -1);
    }
    return lines;
  }

  private computeX(
    line: string,
    font: PDFFont,
    fontSize: number,
    fieldX: number,
    fieldWidth: number,
    align: FieldAlign,
  ): number {
    if (align === 'left') return fieldX + 1; // pequeño margen interior
    const lineWidth = font.widthOfTextAtSize(line, fontSize);
    if (align === 'right') return fieldX + fieldWidth - lineWidth - 1;
    // center
    return fieldX + (fieldWidth - lineWidth) / 2;
  }
}
