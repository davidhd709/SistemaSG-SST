import { Module } from '@nestjs/common';
import { PdfModule } from '../pdf/pdf.module';
import { AuthModule } from '../auth/auth.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';

@Module({
  imports: [PdfModule, AuthModule],
  controllers: [SubmissionsController],
  providers: [SubmissionsService],
  exports: [SubmissionsService],
})
export class SubmissionsModule {}
