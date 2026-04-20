import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class PaymentAuditHandler {
  private readonly logger = new Logger(PaymentAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('payments.payment.captured')
  async handlePaymentCaptured(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('payments.payment.failed')
  async handlePaymentFailed(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('payments.refund.initiated')
  async handleRefundInitiated(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  private async logEvent(event: DomainEvent): Promise<void> {
    try {
      await this.prisma.eventLog.create({
        data: {
          eventName: event.eventName,
          aggregate: event.aggregate,
          aggregateId: event.aggregateId,
          payload: event.payload as any,
          publishedAt: event.occurredAt,
        },
      });

      this.logger.log(`Payment audit logged: ${event.eventName} for ${event.aggregateId}`);
    } catch (error) {
      this.logger.error(`Payment audit logging failed: ${(error as Error).message}`);
    }
  }
}
