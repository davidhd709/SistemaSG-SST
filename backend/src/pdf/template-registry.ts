import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { resolve, sep } from 'node:path';
import { access } from 'node:fs/promises';

export interface TemplateRef {
  formCode: string;
  templateVersion: string;
}

export interface TemplateLocations {
  templatePath: string;
  mappingPath: string;
}

@Injectable()
export class TemplateRegistry {
  private readonly logger = new Logger(TemplateRegistry.name);
  private readonly root = resolve(process.cwd(), 'pdf-templates');
  private readonly defaults: Record<string, string> = {
    'HSE-FO-016': 'v00',
  };

  async resolve(formCode: string, templateVersion?: string): Promise<TemplateLocations> {
    const version = templateVersion ?? this.defaults[formCode];
    if (!version) {
      throw new NotFoundException(`No hay plantilla predeterminada para el formulario "${formCode}".`);
    }
    this.assertSafeSegment(formCode, 'formCode');
    this.assertSafeSegment(version, 'templateVersion');

    const dir = resolve(this.root, formCode, version);
    this.assertWithinRoot(dir);

    const templatePath = resolve(dir, 'template.pdf');
    const mappingPath = resolve(dir, 'mapping.json');

    await this.assertExists(templatePath, `Plantilla PDF no encontrada: ${formCode}/${version}/template.pdf`);
    await this.assertExists(mappingPath, `Mapping no encontrado: ${formCode}/${version}/mapping.json`);

    this.logger.debug(`Plantilla resuelta: ${formCode}/${version}`);
    return { templatePath, mappingPath };
  }

  defaultVersion(formCode: string): string | undefined {
    return this.defaults[formCode];
  }

  private assertSafeSegment(value: string, label: string): void {
    if (
      !value ||
      value.includes('/') ||
      value.includes('\\') ||
      value.includes('..') ||
      value.includes('\0') ||
      !/^[\w\-.]+$/.test(value)
    ) {
      throw new NotFoundException(`Identificador de plantilla inválido en ${label}: "${value}".`);
    }
  }

  private assertWithinRoot(path: string): void {
    if (!path.startsWith(`${this.root}${sep}`)) {
      throw new NotFoundException('Ruta de plantilla fuera del directorio permitido.');
    }
  }

  private async assertExists(path: string, message: string): Promise<void> {
    try {
      await access(path);
    } catch {
      throw new NotFoundException(message);
    }
  }
}
