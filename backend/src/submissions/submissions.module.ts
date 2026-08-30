import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({ imports: [PdfModule], controllers: [SubmissionsController], providers: [SubmissionsService] })
export class SubmissionsModule {}
