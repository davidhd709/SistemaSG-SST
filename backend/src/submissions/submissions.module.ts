import { Module } from '@nestjs/common';
import { ArlModule } from '../arl/arl.module';
import { SubmissionsController } from './submissions.controller';
import { SubmissionsService } from './submissions.service';
@Module({ imports: [ArlModule], controllers: [SubmissionsController], providers: [SubmissionsService] })
export class SubmissionsModule {}
