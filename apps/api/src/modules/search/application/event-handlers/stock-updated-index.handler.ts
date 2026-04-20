import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class StockUpdatedIndexHandler {
  private readonly logger = new Logger(StockUpdatedIndexHandler.name);

  @OnEvent('inventory.stock.out_of_stock')
  async handleOutOfStock(event: DomainEvent): Promise<void> {
    const { mappingId } = event.payload as any;
    this.logger.log(
      `Stock out-of-stock detected for mapping ${mappingId} — search index update may be needed`,
    );
  }

  @OnEvent('inventory.stock.adjusted')
  async handleStockAdjusted(event: DomainEvent): Promise<void> {
    const { mappingId } = event.payload as any;
    this.logger.log(`Stock adjusted for mapping ${mappingId}`);
  }
}
