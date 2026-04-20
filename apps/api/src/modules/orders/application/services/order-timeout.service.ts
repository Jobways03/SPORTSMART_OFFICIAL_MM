import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { OrdersService } from './orders.service';
import {
  OrderRepository,
  ORDER_REPOSITORY,
} from '../../domain/repositories/order.repository.interface';

const CHECK_INTERVAL_MS = 300_000; // 5 minutes

@Injectable()
export class OrderTimeoutService implements OnModuleInit {
  constructor(
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepo: OrderRepository,
    private readonly ordersService: OrdersService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('OrderTimeoutService');
  }

  onModuleInit() {
    this.logger.log('Starting SLA timeout checker — interval: 5 minutes');
    setInterval(() => {
      this.checkExpiredOrders().catch((err) => {
        this.logger.error(`SLA timeout check failed: ${err.message}`, err.stack);
      });
    }, CHECK_INTERVAL_MS);
  }

  async checkExpiredOrders() {
    const now = new Date();

    const expiredSubOrders = await this.orderRepo.findExpiredSubOrders(now);

    if (expiredSubOrders.length === 0) return;

    this.logger.log(`Found ${expiredSubOrders.length} expired sub-order(s) — processing auto-rejection`);

    for (const subOrder of expiredSubOrders) {
      try {
        await this.ordersService.sellerRejectOrder(subOrder.id, subOrder.sellerId || '', {
          reason: 'OTHER',
          note: 'Auto-rejected due to SLA timeout — seller did not respond within deadline',
        });
        this.logger.log(`Auto-rejected sub-order ${subOrder.id} due to SLA timeout`);
      } catch (err: any) {
        this.logger.error(
          `Failed to auto-reject sub-order ${subOrder.id}: ${err.message}`,
          err.stack,
        );
      }
    }
  }
}
