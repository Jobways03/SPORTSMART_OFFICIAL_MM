import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailNotificationHandler } from './event-handlers/email-notification.handler';

@Global()
@Module({
  providers: [EmailService, EmailNotificationHandler],
  exports: [EmailService],
})
export class EmailModule {}
