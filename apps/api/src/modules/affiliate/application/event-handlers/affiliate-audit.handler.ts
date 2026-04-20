import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class AffiliateAuditHandler {
  private readonly logger = new Logger(AffiliateAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('affiliate.referral.attributed')
  async handleReferralAttributed(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('affiliate.commission.locked')
  async handleCommissionLocked(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('affiliate.commission.reversed')
  async handleCommissionReversed(event: DomainEvent): Promise<void> {
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

      this.logger.log(`Affiliate audit logged: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`Affiliate audit logging failed: ${(error as Error).message}`);
    }
  }
}
