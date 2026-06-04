import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LoyaltyService } from '../services/loyalty.service';

/**
 * Phase 182 (#3) — subscribes to `payments.payment.captured` and mints the
 * loyalty rebate for the order (idempotent; no-op when LOYALTY_ENABLED=false).
 * Resolves the order's customer + eligible total from MasterOrder (the event
 * payload carries masterOrderId, not the userId).
 */
@Injectable()
export class LoyaltyPaymentCapturedHandler {
  private readonly logger = new Logger(LoyaltyPaymentCapturedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loyalty: LoyaltyService,
  ) {}

  @OnEvent('payments.payment.captured')
  async onPaymentCaptured(event: { payload?: { masterOrderId?: string } }): Promise<void> {
    if (!this.loyalty.enabled()) return;
    const masterOrderId = event?.payload?.masterOrderId;
    if (!masterOrderId) return;
    try {
      const order = await this.prisma.masterOrder.findUnique({
        where: { id: masterOrderId },
        select: { customerId: true, orderNumber: true, totalAmountInPaise: true },
      });
      if (!order) return;
      await this.loyalty.earnForOrder({
        userId: order.customerId,
        orderId: masterOrderId,
        orderNumber: order.orderNumber,
        eligibleAmountInPaise: Number(order.totalAmountInPaise),
      });
    } catch (err) {
      // Loyalty is a best-effort marketing credit — never block the payment flow.
      this.logger.error(
        `Loyalty earn failed for order ${masterOrderId}: ${(err as Error).message}`,
      );
    }
  }
}
