import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class ShipmentAuditHandler {
  private readonly logger = new Logger(ShipmentAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('shipping.shipment.dispatched')
  async handleDispatched(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('shipping.shipment.delivered')
  async handleDelivered(event: DomainEvent): Promise<void> {
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

      this.logger.log(`Shipment audit logged: ${event.eventName}`);
    } catch (error) {
      this.logger.error(`Shipment audit logging failed: ${(error as Error).message}`);
    }
  }
}
