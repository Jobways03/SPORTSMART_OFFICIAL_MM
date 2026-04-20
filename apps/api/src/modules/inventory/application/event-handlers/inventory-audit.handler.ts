import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class InventoryAuditHandler {
  private readonly logger = new Logger(InventoryAuditHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('inventory.stock.reserved')
  async handleStockReserved(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('inventory.stock.released')
  async handleStockReleased(event: DomainEvent): Promise<void> {
    await this.logEvent(event);
  }

  @OnEvent('inventory.stock.deducted')
  async handleStockDeducted(event: DomainEvent): Promise<void> {
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

      this.logger.log(`Inventory audit logged: ${event.eventName} for ${event.aggregateId}`);
    } catch (error) {
      this.logger.error(`Inventory audit logging failed: ${(error as Error).message}`);
    }
  }
}
