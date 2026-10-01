import { Global, Module } from '@nestjs/common';
import { PdfService } from './pdf.service';
import { TemplateRegistry } from './template-registry';
import { TemplateLoader } from './template-loader';
import { FieldRenderer } from './field-renderer';
import { TextRenderer } from './renderers/text.renderer';
import { CheckboxRenderer } from './renderers/checkbox.renderer';
import { ImageRenderer } from './renderers/image.renderer';
import { CrewTableRenderer } from './renderers/crew-table.renderer';

@Global()
@Module({
  providers: [
    PdfService,
    TemplateRegistry,
    TemplateLoader,
    FieldRenderer,
    TextRenderer,
    CheckboxRenderer,
    ImageRenderer,
    CrewTableRenderer,
  ],
  exports: [
    PdfService,
    TemplateRegistry,
    TemplateLoader,
    FieldRenderer,
  ],
})
export class PdfModule {}

