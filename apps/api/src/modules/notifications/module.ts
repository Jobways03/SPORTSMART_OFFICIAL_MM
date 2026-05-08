import { Module } from '@nestjs/common';
import { EmailModule } from '../../integrations/email/email.module';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { NotificationsPublicFacade } from './application/facades/notifications-public.facade';
import { NotificationRouter } from './application/services/notification-router.service';
import { NotificationWorker } from './application/services/notification-worker.service';
import { TemplateRegistry } from './application/services/template-registry.service';
import { TemplateRenderer } from './application/services/template-renderer.service';
import { NotificationGateService } from './application/services/notification-gate.service';
import { OrderNotificationHandler } from './application/event-handlers/order-notification.handler';
import { WalletNotificationHandler } from './application/event-handlers/wallet-notification.handler';
import { TicketNotificationHandler } from './application/event-handlers/ticket-notification.handler';
import { RefundCompletedNotificationHandler } from './application/event-handlers/refund-completed.handler';
import { DisputeNotificationHandler } from './application/event-handlers/dispute-notification.handler';
import { ReconciliationNotificationHandler } from './application/event-handlers/reconciliation-notification.handler';
import { EmailNotificationProvider } from './infrastructure/providers/email.provider';
import { SmsNotificationProvider } from './infrastructure/providers/sms.provider';
import { WhatsAppNotificationProvider } from './infrastructure/providers/whatsapp.provider';
import { RedisNotificationQueue } from './infrastructure/queue/redis-notification-queue';
import { NotificationLogRepository } from './infrastructure/persistence/prisma/notification-log.repository';
import { NotificationPreferenceRepository } from './infrastructure/persistence/prisma/notification-preference.repository';
import { CustomerNotificationsController } from './presentation/controllers/customer-notifications.controller';
import { AdminNotificationLogsController } from './presentation/controllers/list-notification-logs.controller';
import { AdminNotificationTemplatesController } from './presentation/controllers/preview-template.controller';
import { AdminNotificationPreferencesController } from './presentation/controllers/admin-preferences.controller';
import { NOTIFICATION_QUEUE } from './application/ports/notification-queue.port';

@Module({
  imports: [EmailModule],
  controllers: [
    CustomerNotificationsController,
    AdminNotificationLogsController,
    AdminNotificationTemplatesController,
    AdminNotificationPreferencesController,
  ],
  providers: [
    UserAuthGuard,
    AdminAuthGuard,

    // Public facade other modules consume
    NotificationsPublicFacade,

    // Channel providers
    EmailNotificationProvider,
    SmsNotificationProvider,
    WhatsAppNotificationProvider,

    // Routing + worker pipeline
    NotificationRouter,
    NotificationLogRepository,
    NotificationPreferenceRepository,
    NotificationWorker,

    // Templates
    TemplateRegistry,
    TemplateRenderer,

    // Phase 8 (PR 8.2) — preference + suppression gate.
    NotificationGateService,

    // Queue (Redis-backed today; BullMQ tomorrow — same interface)
    {
      provide: NOTIFICATION_QUEUE,
      useClass: RedisNotificationQueue,
    },

    // Event handlers
    OrderNotificationHandler,
    WalletNotificationHandler,
    TicketNotificationHandler,
    RefundCompletedNotificationHandler,
    DisputeNotificationHandler,
    ReconciliationNotificationHandler,
  ],
  exports: [NotificationsPublicFacade, NotificationGateService],
})
export class NotificationsModule {}
