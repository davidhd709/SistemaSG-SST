import { Injectable, Logger } from '@nestjs/common';
import { PDFPage, PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
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
        const isSignature = field.type === 'SIGNATURE';
        const bytesToEmbed = isSignature ? this.removeWhiteBackground(imageBytes) : imageBytes;
        embeddedImage = await pdfDoc.embedPng(bytesToEmbed);
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

  /**
   * Procesa la firma digital para que sea nítida, contrastada y perfectamente legible:
   * 1. Elimina el fondo blanco (transparencia total).
   * 2. Recorta automáticamente los márgenes vacíos (auto-crop al trazo de tinta).
   * 3. Aplica engrosamiento morfológico (dilatación) y refuerzo a negro/azul tinta profundo,
   *    asegurando que las líneas no se desvanezcan al escalar o al imprimir.
   */
  private removeWhiteBackground(imageBytes: Buffer): Buffer {
    try {
      const src = PNG.sync.read(imageBytes);
      const { width, height, data } = src;

      let minX = width;
      let maxX = 0;
      let minY = height;
      let maxY = 0;
      const isInk = new Uint8Array(width * height);
      let inkCount = 0;

      // Detectar píxeles que pertenecen al trazo (no blancos ni transparentes)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (width * y + x) << 2;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          const a = data[idx + 3];

          // Si el píxel tiene opacidad y no es blanco de fondo
          if (a > 30 && (r < 225 || g < 225 || b < 225)) {
            isInk[y * width + x] = 1;
            inkCount++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }

      // Si no hay trazo apreciable, retornar imagen original
      if (inkCount === 0 || minX > maxX || minY > maxY) {
        return imageBytes;
      }

      // Añadir margen mínimo alrededor del trazo (padding de 6px)
      const pad = 6;
      minX = Math.max(0, minX - pad);
      maxX = Math.min(width - 1, maxX + pad);
      minY = Math.max(0, minY - pad);
      maxY = Math.min(height - 1, maxY + pad);

      const cropW = maxX - minX + 1;
      const cropH = maxY - minY + 1;
      const dst = new PNG({ width: cropW, height: cropH });

      // Radio de dilatación: 2 píxeles para asegurar trazo visible en escala pequeña e impresión
      const r = 2;

      for (let cy = 0; cy < cropH; cy++) {
        const sy = minY + cy;
        for (let cx = 0; cx < cropW; cx++) {
          const sx = minX + cx;
          let inkFound = false;

          for (let dy = -r; dy <= r && !inkFound; dy++) {
            const ny = sy + dy;
            if (ny < 0 || ny >= height) continue;
            for (let dx = -r; dx <= r; dx++) {
              const nx = sx + dx;
              if (nx < 0 || nx >= width) continue;
              if (isInk[ny * width + nx]) {
                inkFound = true;
                break;
              }
            }
          }

          const dstIdx = (cropW * cy + cx) << 2;
          if (inkFound) {
            // Tinta oscura sólida (negro azulado profundo de bolígrafo)
            dst.data[dstIdx] = 10;
            dst.data[dstIdx + 1] = 20;
            dst.data[dstIdx + 2] = 50;
            dst.data[dstIdx + 3] = 255;
          } else {
            dst.data[dstIdx + 3] = 0; // Totalmente transparente
          }
        }
      }

      return PNG.sync.write(dst);
    } catch (err) {
      this.logger.warn(`No fue posible procesar la firma: ${String(err)}`);
      return imageBytes;
    }
  }

  private isPng(bytes: Buffer): boolean {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }

  private isJpeg(bytes: Buffer): boolean {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
}
