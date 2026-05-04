import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';

interface RefundCompletedPayload {
  returnId: string;
  returnNumber: string;
  refundAmount: number;
  refundReference: string;
  processedBy: string;
}

@Injectable()
export class RefundCompletedNotificationHandler {
  private readonly logger = new Logger(RefundCompletedNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('returns.refund.completed')
  async onRefundCompleted(event: DomainEvent<RefundCompletedPayload>) {
    const p = event.payload;
    try {
      const ret = await this.prisma.return.findUnique({
        where: { id: p.returnId },
        select: {
          customerId: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      });
      if (!ret) {
        this.logger.warn(`refund.completed for unknown return ${p.returnId}`);
        return;
      }
      await this.notifications.notifyFromTemplate({
        eventClass: 'refund',
        templateKey: 'refund.completed.email',
        recipientId: ret.customerId,
        eventId: p.returnId,
        vars: {
          customerName: ret.customer
            ? `${ret.customer.firstName} ${ret.customer.lastName}`.trim()
            : 'there',
          returnNumber: p.returnNumber,
          refundAmount: Number(p.refundAmount).toFixed(2),
          refundReference: p.refundReference,
          preferencesUrl: process.env.STOREFRONT_URL
            ? `${process.env.STOREFRONT_URL}/account/notifications`
            : '/account/notifications',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed refund completed notification: ${(err as Error).message}`,
      );
    }
  }
}
