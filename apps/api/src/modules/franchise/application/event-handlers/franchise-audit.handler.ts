import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class FranchiseAuditHandler {
  private readonly logger = new Logger(FranchiseAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('franchise.partner.registered')
  async handleFranchiseRegistered(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('franchise.order.fulfilled')
  async handleOrderFulfilled(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('franchise.pos.sale_completed')
  async handlePosSale(event: DomainEvent): Promise<void> {
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

      this.logger.log(`Franchise audit logged: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`Franchise audit logging failed: ${(error as Error).message}`);
    }
  }
}
