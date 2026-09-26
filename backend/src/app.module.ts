import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { ComplianceModule } from './compliance/compliance.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';
import { getNumber } from './common/env';
import { CollaboratorsModule } from './collaborators/collaborators.module';
import { UsersModule } from './users/users.module';
import { ArlModule } from './arl/arl.module';
import { FormsModule } from './forms/forms.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { FilesModule } from './files/files.module';
import { PdfModule } from './pdf/pdf.module';
import { LegalModule } from './legal/legal.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // pnpm ejecuta los scripts del workspace desde backend; Docker inyecta
      // las variables directamente. Se admiten ambos puntos de arranque.
      envFilePath: ['.env', '../.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: getNumber(config, 'THROTTLE_TTL_MS', 60_000),
          limit: getNumber(config, 'THROTTLE_LIMIT', 100),
        },
      ],
    }),
    PrismaModule,
    AuditModule,
    ComplianceModule,
    AuthModule,
    CollaboratorsModule,
    UsersModule,
    ArlModule,
    FormsModule,
    FilesModule,
    PdfModule,
    SubmissionsModule,
    ApprovalsModule,
    LegalModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
