import { Module } from '@nestjs/common';
import { NotificationsPublicFacade } from './application/facades/notifications-public.facade';
import { OrderNotificationHandler } from './application/event-handlers/order-notification.handler';

@Module({
  providers: [NotificationsPublicFacade, OrderNotificationHandler],
  exports: [NotificationsPublicFacade],
})
export class NotificationsModule {}
