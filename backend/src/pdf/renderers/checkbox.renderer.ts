import { Injectable, Logger } from '@nestjs/common';
import { PDFPage, rgb } from 'pdf-lib';
import type { CheckboxField } from '../template-loader';

export interface RenderCheckboxOptions {
  page: PDFPage;
  field: CheckboxField;
  /** Si la casilla debe aparecer marcada. */
  checked: boolean;
}

/**
 * Renderiza una marca (✗ o X) sobre la posición exacta de una casilla que ya
 * existe en el PDF original.
 *
 * NO dibuja el cuadro de la casilla — ese ya está en la plantilla.
 * Solo superpone el símbolo de marca centrado dentro del área indicada.
 */
@Injectable()
export class CheckboxRenderer {
  private readonly logger = new Logger(CheckboxRenderer.name);

  render({ page, field, checked }: RenderCheckboxOptions): void {
    if (!checked) return; // casilla vacía → no dibujamos nada

    const { x, y, size, mark = 'X' } = field;
    const pageHeight = page.getHeight();

    // Convertir de coordenadas top-left a bottom-left si aplica, o usar bottom-left directamente.
    // El área de la casilla es un cuadrado de `size × size`.
    const isTopLeft = (field as { origin?: string }).origin === 'top-left';
    const baseY = isTopLeft ? pageHeight - y - size : y;

    // Centrar el símbolo dentro del área de la casilla.
    const fontSize = size * 0.85;
    const symbolX = x + size * 0.1;
    const symbolY = baseY + size * 0.15;

    try {
      page.drawText(mark, {
        x: symbolX,
        y: symbolY,
        size: fontSize,
        color: rgb(0, 0, 0),
      });
    } catch (error) {
      this.logger.error(`No fue posible renderizar checkbox en (x=${x}, y=${y}): ${String(error)}`);
    }
  }

  /**
   * Determina si una casilla debe marcarse según su configuración `checkedWhen`.
   *
   * Soporta dos modos:
   *  - `includes`: el valor de `answers[field]` es un array que contiene la opción.
   *  - `equals`  : el valor de `answers[field]` es igual al string indicado.
   */
  shouldCheck(checkedWhen: CheckboxField['checkedWhen'], answers: Record<string, unknown>): boolean {
    const { field, includes, equals } = checkedWhen;
    const rawValue = answers[field];

    if (equals !== undefined) {
      return String(rawValue ?? '').trim().toLocaleUpperCase('es-CO') === equals.trim().toLocaleUpperCase('es-CO');
    }

    if (includes !== undefined) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const normalized = includes.trim().toLocaleUpperCase('es-CO');
      return values.some(
        (v) => String(v ?? '').trim().toLocaleUpperCase('es-CO') === normalized,
      );
    }

    // Sin condición definida: nunca marcar.
    return false;
  }
}
