import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../common/request-context';
import { UUID_PARAM_PIPE } from '../common/uuid-param.pipe';
import { NotificationsQueryDto } from './dto/notifications-query.dto';
import { PushSubscriptionDto, PushUnsubscribeDto } from './dto/push-subscription.dto';
import { NotificationsService } from './notifications.service';

/** Bandeja de cada persona autenticada: solo ve y marca sus propios avisos. */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get() list(@Query() query: NotificationsQueryDto, @Req() request: AuthenticatedRequest) {
    return this.notifications.list(request.principal, query.unread, query.take);
  }

  @Get('unread-count') unreadCount(@Req() request: AuthenticatedRequest) {
    return this.notifications.unreadCount(request.principal);
  }

  @Post('read-all') @HttpCode(200) readAll(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.principal);
  }

  @Post(':id/read') @HttpCode(200) read(
    @Param('id', UUID_PARAM_PIPE) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notifications.markRead(request.principal, id);
  }

  /** Llave VAPID pública, o `null` si el push no está configurado. */
  @Get('push/public-key') publicKey() {
    return this.notifications.pushPublicKey();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('push/subscriptions')
  @HttpCode(200)
  subscribe(@Body() dto: PushSubscriptionDto, @Req() request: AuthenticatedRequest) {
    return this.notifications.subscribe(request, dto);
  }

  @Delete('push/subscriptions') unsubscribe(@Body() dto: PushUnsubscribeDto, @Req() request: AuthenticatedRequest) {
    return this.notifications.unsubscribe(request.principal, dto.endpoint);
  }
}
