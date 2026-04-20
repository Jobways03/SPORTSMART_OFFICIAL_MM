import { Injectable } from '@nestjs/common';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import {
  BadRequestAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { OrdersPublicFacade } from '../../../orders/application/facades/orders-public.facade';

/**
 * PaymentsPublicFacade — uses OrdersPublicFacade for all order data access.
 * Does NOT inject PrismaService directly (strict modular monolith).
 */
@Injectable()
export class PaymentsPublicFacade {
  constructor(
    private readonly ordersFacade: OrdersPublicFacade,
    private readonly eventBus: EventBusService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PaymentsPublicFacade');
  }

  /**
   * Mark a master order as PAID.
   */
  async markOrderPaid(params: {
    masterOrderId: string;
    actorType: string;
    actorId?: string;
    paymentReference?: string;
    notes?: string;
  }) {
    const order = await this.ordersFacade.getMasterOrderBasic(params.masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.paymentStatus === 'PAID') {
      this.logger.warn(`Order ${order.orderNumber} already PAID`);
      return order;
    }
    if (order.paymentStatus === 'CANCELLED' || order.paymentStatus === 'VOIDED') {
      throw new BadRequestAppException(
        `Cannot mark order as PAID — current status: ${order.paymentStatus}`,
      );
    }

    const updated = await this.ordersFacade.updatePaymentStatus(params.masterOrderId, 'PAID');

    this.eventBus
      .publish({
        eventName: 'payments.payment.captured',
        aggregate: 'MasterOrder',
        aggregateId: params.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: params.masterOrderId,
          orderNumber: order.orderNumber,
          amount: Number(order.totalAmount),
          paymentMethod: order.paymentMethod,
          paymentReference: params.paymentReference,
          actorType: params.actorType,
          actorId: params.actorId,
        },
      })
      .catch(() => {});

    this.logger.log(`Order ${order.orderNumber} marked PAID by ${params.actorType}`);
    return updated;
  }

  async getOrderPaymentStatus(masterOrderId: string) {
    const order = await this.ordersFacade.getOrderPaymentStatus(masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    return order;
  }

  async markOrderPaymentFailed(params: {
    masterOrderId: string;
    reason: string;
    actorType: string;
  }) {
    const order = await this.ordersFacade.getMasterOrderBasic(params.masterOrderId);
    if (!order) throw new NotFoundAppException('Order not found');
    if (order.paymentStatus === 'PAID') {
      throw new BadRequestAppException('Cannot mark a PAID order as failed');
    }

    const updated = await this.ordersFacade.updatePaymentStatus(params.masterOrderId, 'CANCELLED');

    this.eventBus
      .publish({
        eventName: 'payments.payment.failed',
        aggregate: 'MasterOrder',
        aggregateId: params.masterOrderId,
        occurredAt: new Date(),
        payload: {
          masterOrderId: params.masterOrderId,
          orderNumber: order.orderNumber,
          reason: params.reason,
        },
      })
      .catch(() => {});

    return updated;
  }
}
