import { Injectable, Logger } from '@nestjs/common';
import { PDFPage, PDFFont, PDFDocument, rgb } from 'pdf-lib';
import { ImageRenderer } from './image.renderer';

export interface CrewMemberRow {
  cedula: string;
  nombre: string;
  certificado: string;
  cargo: string;
  seguridadSocial: string;
  signatureBytes?: Buffer;
}

export interface CrewTableConfig {
  x: number;
  y: number; // Y de la base inferior del área de cuadrilla
  width: number;
  height: number;
  rowHeight: number;
  columns: {
    cedula: { x: number; width: number; fontSize: number };
    nombre: { x: number; width: number; fontSize: number };
    certificado: { x: number; width: number; fontSize: number };
    cargo: { x: number; width: number; fontSize: number };
    segSocial: { x: number; width: number; fontSize: number };
    firma: { x: number; width: number; height: number };
  };
}

@Injectable()
export class CrewTableRenderer {
  private readonly logger = new Logger(CrewTableRenderer.name);

  constructor(private readonly imageRenderer: ImageRenderer) {}

  async render(
    page: PDFPage,
    pdfDoc: PDFDocument,
    font: PDFFont,
    config: CrewTableConfig,
    members: CrewMemberRow[],
  ): Promise<void> {
    if (!members || members.length === 0) return;

    const maxRows = Math.floor(config.height / config.rowHeight);
    if (members.length > maxRows) {
      this.logger.warn(
        `La cuadrilla tiene ${members.length} integrantes pero el área física del formulario oficial solo soporta ${maxRows}. ` +
          `Se renderizarán los primeros ${maxRows} respetando la regla de inmutabilidad (D2).`,
      );
    }

    const rowsToRender = members.slice(0, maxRows);

    for (let i = 0; i < rowsToRender.length; i++) {
      const member = rowsToRender[i];
      // Las filas se renderizan de arriba hacia abajo
      // La primera fila (i=0) está en la parte superior: baseY = config.y + config.height - (i + 1) * config.rowHeight
      const rowY = config.y + config.height - (i + 1) * config.rowHeight;
      const textY = rowY + 1.5;

      const cols = config.columns;

      // Cédula
      if (member.cedula) {
        page.drawText(member.cedula, {
          x: cols.cedula.x + 2,
          y: textY,
          size: cols.cedula.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Nombre y Apellidos
      if (member.nombre) {
        page.drawText(member.nombre.slice(0, 35), {
          x: cols.nombre.x + 2,
          y: textY,
          size: cols.nombre.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Certificado de alturas
      if (member.certificado) {
        page.drawText(member.certificado, {
          x: cols.certificado.x + 2,
          y: textY,
          size: cols.certificado.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Cargo
      if (member.cargo) {
        page.drawText(member.cargo.slice(0, 25), {
          x: cols.cargo.x + 2,
          y: textY,
          size: cols.cargo.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Verificación de Seguridad Social
      if (member.seguridadSocial) {
        page.drawText(member.seguridadSocial, {
          x: cols.segSocial.x + 2,
          y: textY,
          size: cols.segSocial.fontSize,
          font,
          color: rgb(0, 0, 0),
        });
      }

      // Firma
      if (member.signatureBytes && member.signatureBytes.length > 0) {
        await this.imageRenderer.render({
          page,
          pdfDoc,
          field: {
            type: 'SIGNATURE',
            page: 0,
            x: cols.firma.x,
            y: rowY,
            width: cols.firma.width,
            height: cols.firma.height,
            fit: 'contain',
            align: 'center',
          },
          imageBytes: member.signatureBytes,
        });
      }
    }
  }
}
