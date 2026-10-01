import { Injectable, Logger } from '@nestjs/common';
import { PDFPage, PDFDocument } from 'pdf-lib';
import type { SignatureField, ImageField } from '../template-loader';

export interface RenderImageOptions {
  page: PDFPage;
  pdfDoc: PDFDocument;
  field: SignatureField | ImageField;
  /** Bytes de la imagen PNG o JPEG. */
  imageBytes: Buffer;
}

/**
 * Incrusta imágenes PNG o JPEG sobre una página del PDF oficial.
 * Se utiliza para firmas (SIGNATURE) e imágenes genéricas (IMAGE).
 *
 * Comportamiento:
 * - Detecta el formato por los bytes mágicos del archivo.
 * - Escala la imagen para que quepa dentro del área definida (fit: 'contain').
 * - Centra la imagen si el área es más grande que la imagen escalada.
 * - No deforma la imagen (mantiene aspect ratio).
 * - No modifica la plantilla original.
 */
@Injectable()
export class ImageRenderer {
  private readonly logger = new Logger(ImageRenderer.name);

  async render({ page, pdfDoc, field, imageBytes }: RenderImageOptions): Promise<void> {
    if (!imageBytes || imageBytes.length === 0) return;

    const { x, y, width, height, fit = 'contain' } = field;
    const align = 'align' in field ? (field.align ?? 'center') : 'center';

    const pageHeight = page.getHeight();

    let embeddedImage;
    try {
      if (this.isPng(imageBytes)) {
        embeddedImage = await pdfDoc.embedPng(imageBytes);
      } else if (this.isJpeg(imageBytes)) {
        embeddedImage = await pdfDoc.embedJpg(imageBytes);
      } else {
        this.logger.warn(`Formato de imagen no reconocido (firma en x=${x}, y=${y}). Se omite.`);
        return;
      }
    } catch (error) {
      this.logger.error(`No fue posible embeber la imagen en (x=${x}, y=${y}): ${String(error)}`);
      return;
    }

    const imgWidth = embeddedImage.width;
    const imgHeight = embeddedImage.height;

    // Calcular escala para que la imagen quepa en el área (fit: 'contain').
    let drawWidth: number;
    let drawHeight: number;

    if (fit === 'fill') {
      drawWidth = width;
      drawHeight = height;
    } else {
      // contain: escalar manteniendo aspect ratio
      const scaleX = width / imgWidth;
      const scaleY = height / imgHeight;
      const scale = Math.min(scaleX, scaleY, 1); // nunca agrandar
      drawWidth = imgWidth * scale;
      drawHeight = imgHeight * scale;
    }

    // Alineación horizontal dentro del área.
    let drawX: number;
    if (align === 'left') {
      drawX = x;
    } else if (align === 'right') {
      drawX = x + width - drawWidth;
    } else {
      drawX = x + (width - drawWidth) / 2;
    }

    // Convertir Y: si es top-left a bottom-left, o usar bottom-left directamente.
    // Centramos verticalmente dentro del área.
    const isTopLeft = (field as { origin?: string }).origin === 'top-left';
    const drawY = isTopLeft
      ? pageHeight - y - height + (height - drawHeight) / 2
      : y + (height - drawHeight) / 2;

    try {
      page.drawImage(embeddedImage, {
        x: drawX,
        y: drawY,
        width: drawWidth,
        height: drawHeight,
        opacity: 1,
      });
    } catch (error) {
      this.logger.error(`Error al dibujar imagen en (x=${x}, y=${y}): ${String(error)}`);
    }
  }

  // ── Detección de formato ──────────────────────────────────────────────────

  private isPng(bytes: Buffer): boolean {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }

  private isJpeg(bytes: Buffer): boolean {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
}
