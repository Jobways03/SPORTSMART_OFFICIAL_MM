import { Module } from '@nestjs/common';
import { NotificationsPublicFacade } from './application/facades/notifications-public.facade';

@Module({
  providers: [NotificationsPublicFacade],
  exports: [NotificationsPublicFacade],
})
export class NotificationsModule {}
