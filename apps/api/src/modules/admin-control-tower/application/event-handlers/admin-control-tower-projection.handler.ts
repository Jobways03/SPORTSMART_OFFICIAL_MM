import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

@Injectable()
export class AdminControlTowerProjectionHandler {
  private readonly logger = new Logger(AdminControlTowerProjectionHandler.name);

  @OnEvent('orders.master.created')
  async handleOrderCreated(event: DomainEvent): Promise<void> {
    this.logger.log(`Control tower projection: new order ${event.aggregateId}`);
  }

  @OnEvent('orders.sub_order.status_changed')
  async handleSubOrderStatusChanged(event: DomainEvent): Promise<void> {
    const { subOrderId, newStatus } = event.payload as any;
    this.logger.log(`Control tower projection: sub-order ${subOrderId} → ${newStatus}`);
  }

  @OnEvent('returns.return.created')
  async handleReturnCreated(event: DomainEvent): Promise<void> {
    this.logger.log(`Control tower projection: return requested ${event.aggregateId}`);
  }

  @OnEvent('commission.record.created')
  async handleCommissionRecorded(event: DomainEvent): Promise<void> {
    this.logger.log(`Control tower projection: commission recorded ${event.aggregateId}`);
  }
}
