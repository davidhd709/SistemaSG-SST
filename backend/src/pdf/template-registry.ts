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
  // Relativa al módulo y no a `process.cwd()`: `src/pdf` y `dist/pdf` están a dos
  // niveles de `backend/`, así que la ruta es la misma al arrancar desde la raíz,
  // desde `backend/` o dentro de la imagen Docker (TEC-001).
  private readonly root = resolve(__dirname, '..', '..', 'pdf-templates');
  private readonly defaults: Record<string, string> = {
    'HSE-FO-016': 'v00',
    // La carpeta repite la versión impresa en cada formato oficial.
    'HSE-FO-018': 'v02',
    'FORSG-03': 'v002',
    'HSE-FO-023': 'v00',
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
