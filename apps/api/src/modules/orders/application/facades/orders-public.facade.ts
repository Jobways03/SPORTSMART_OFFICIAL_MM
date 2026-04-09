import { Injectable } from '@nestjs/common';
import { OrdersService } from '../services/orders.service';

@Injectable()
export class OrdersPublicFacade {
  constructor(private readonly ordersService: OrdersService) {}

  async getOrder(id: string) {
    return this.ordersService.getOrder(id);
  }

  async listOrders(filters: {
    page: number;
    limit: number;
    paymentStatus?: string;
    fulfillmentStatus?: string;
    acceptStatus?: string;
    orderStatus?: string;
    search?: string;
  }) {
    return this.ordersService.listOrders(filters);
  }
}
