import { Global, Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceAdminService } from './compliance-admin.service';
import { ComplianceService } from './compliance.service';

@Global()
@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceAdminService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
