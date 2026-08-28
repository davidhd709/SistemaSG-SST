import { Module } from '@nestjs/common';
import { ArlModule } from '../arl/arl.module';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
@Module({ imports: [ArlModule], controllers: [ApprovalsController], providers: [ApprovalsService] })
export class ApprovalsModule {}
