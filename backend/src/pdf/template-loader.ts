import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

export type FieldAlign = 'left' | 'center' | 'right';
export type OverflowPolicy = 'shrink' | 'truncate' | 'warn';

export interface TextField {
  type: 'TEXT' | 'MULTILINE_TEXT' | 'NUMBER' | 'DATE' | 'TIME';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  minFontSize?: number;
  maxLines?: number;
  align?: FieldAlign;
  overflow?: OverflowPolicy;
}

export interface CheckboxField {
  type: 'CHECKBOX';
  page: number;
  x: number;
  y: number;
  size: number;
  mark?: string;
  checkedWhen: { field: string; includes?: string; equals?: string };
}

export interface SignatureField {
  type: 'SIGNATURE';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fit?: 'contain' | 'fill';
  align?: 'left' | 'center' | 'right';
  memberIndex?: number;
  fieldKey?: string;
}

export interface ImageField {
  type: 'IMAGE';
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fit?: 'contain' | 'fill';
}

export interface CrewTableField {
  type: 'CREW_TABLE';
  page: number;
  x: number;
  y: number;
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

export type MappingField = TextField | CheckboxField | SignatureField | ImageField | CrewTableField;

export interface TemplateMeta {
  formCode: string;
  templateVersion: string;
  pageCount: number;
  pageSize: { width: number; height: number };
  orientation: 'portrait' | 'landscape';
  coordinateOrigin?: 'top-left' | 'bottom-left';
}

export interface TemplateMapping {
  meta: TemplateMeta;
  fields: Record<string, MappingField>;
}

export interface LoadedTemplate {
  pdfDoc: PDFDocument;
  mapping: TemplateMapping;
  pageCount: number;
}

@Injectable()
export class TemplateLoader {
  private readonly logger = new Logger(TemplateLoader.name);

  async load(templatePath: string, mappingPath: string): Promise<LoadedTemplate> {
    const [templateBytes, mappingRaw] = await Promise.all([
      this.readTemplate(templatePath),
      this.readMapping(mappingPath),
    ]);

    const mapping = this.parseMapping(mappingRaw, mappingPath);

    let pdfDoc: PDFDocument;
    try {
      pdfDoc = await PDFDocument.load(templateBytes, { ignoreEncryption: false });
    } catch (error) {
      this.logger.error(`No fue posible cargar el PDF de plantilla: ${templatePath}`, error);
      throw new InternalServerErrorException('El archivo de plantilla PDF no pudo cargarse correctamente.');
    }

    const pageCount = pdfDoc.getPageCount();
    this.logger.debug(`Plantilla cargada: ${pageCount} páginas | ${templateBytes.length} bytes`);
    return { pdfDoc, mapping, pageCount };
  }

  private async readTemplate(templatePath: string): Promise<Uint8Array> {
    try {
      const buf = await readFile(templatePath);
      return new Uint8Array(buf);
    } catch (error) {
      this.logger.error(`No se pudo leer el template PDF: ${templatePath}`, error);
      throw new InternalServerErrorException('Archivo de plantilla PDF no encontrado o sin permisos de lectura.');
    }
  }

  private async readMapping(mappingPath: string): Promise<string> {
    try {
      return await readFile(mappingPath, 'utf-8');
    } catch (error) {
      this.logger.error(`No se pudo leer el mapping: ${mappingPath}`, error);
      throw new InternalServerErrorException('Archivo de mapping de plantilla no encontrado.');
    }
  }

  private parseMapping(raw: string, mappingPath: string): TemplateMapping {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new InternalServerErrorException(`El mapping JSON no es válido: ${mappingPath}. ${String(error)}`);
    }

    const mapping = parsed as TemplateMapping;
    if (!mapping?.meta?.formCode) throw new InternalServerErrorException(`El mapping ${mappingPath} no tiene meta.formCode.`);
    if (!mapping?.meta?.templateVersion) throw new InternalServerErrorException(`El mapping ${mappingPath} no tiene meta.templateVersion.`);
    if (typeof mapping.meta.pageCount !== 'number' || mapping.meta.pageCount < 1) throw new InternalServerErrorException(`El mapping ${mappingPath} tiene pageCount inválido.`);
    if (!mapping.fields || typeof mapping.fields !== 'object') throw new InternalServerErrorException(`El mapping ${mappingPath} no tiene campos definidos.`);

    const validTypes = new Set(['TEXT', 'MULTILINE_TEXT', 'NUMBER', 'DATE', 'TIME', 'CHECKBOX', 'SIGNATURE', 'IMAGE', 'CREW_TABLE']);
    for (const [key, field] of Object.entries(mapping.fields)) {
      if (!validTypes.has((field as MappingField).type)) {
        throw new InternalServerErrorException(`El campo "${key}" tiene un tipo inválido: "${(field as MappingField).type}".`);
      }
    }
    return mapping;
  }
}
