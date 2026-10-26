import { Module } from '@nestjs/common';
import { SubmissionsModule } from '../submissions/submissions.module';
import { NotificationDigestService } from './notification-digest.service';

/**
 * Separado de NotificationsModule porque necesita SubmissionsService, que a su
 * vez emite avisos: así no hay dependencia circular entre módulos.
 */
@Module({ imports: [SubmissionsModule], providers: [NotificationDigestService] })
export class NotificationDigestModule {}
