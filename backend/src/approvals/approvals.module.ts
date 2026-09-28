import { Module } from '@nestjs/common';
import { ArlModule } from '../arl/arl.module';
import { SubmissionsModule } from '../submissions/submissions.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
@Module({ imports: [ArlModule, SubmissionsModule], controllers: [ApprovalsController], providers: [ApprovalsService] })
export class ApprovalsModule {}
