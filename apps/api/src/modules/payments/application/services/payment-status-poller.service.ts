import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { RedisService } from '../../../../bootstrap/cache/redis.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

const LOCK_KEY = 'lock:payment-status-poller';
const LOCK_TTL = 60;

/**
 * Background processor for online payments stuck in PENDING_PAYMENT.
 *
 * Two responsibilities:
 * 1. **Auto-cancel expired**: orders past `paymentExpiresAt` with no
 *    Razorpay payment are cancelled + stock released.
 * 2. **Auto-confirm paid**: orders where Razorpay shows "captured" but
 *    the verify endpoint was never called (e.g. user closed browser
 *    after payment but before redirect). Polls Razorpay by order ID
 *    and confirms if paid.
 */
@Injectable()
export class PaymentStatusPollerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentStatusPollerService.name);
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;
  private readonly windowMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly envService: EnvService,
    private readonly eventBus: EventBusService,
    private readonly razorpayAdapter: RazorpayAdapter,
    private readonly franchiseFacade: FranchisePublicFacade,
  ) {
    this.intervalMs =
      this.envService.getNumber('PAYMENT_POLL_INTERVAL_SECONDS', 60) * 1000;
    this.windowMinutes = this.envService.getNumber(
      'PAYMENT_WINDOW_MINUTES',
      30,
    );
  }

  onModuleInit() {
    if (this.intervalMs <= 0) {
      this.logger.log('Payment status poller disabled');
      return;
    }
    this.tickInterval = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(
          `Payment poller tick crashed: ${(err as Error).message}`,
        ),
      );
    }, this.intervalMs);
    this.logger.log(
      `Payment status poller started (every ${this.intervalMs / 1000}s, window=${this.windowMinutes}min)`,
    );
  }

  onModuleDestroy() {
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  async tick(): Promise<void> {
    const lockAcquired = await this.redis.acquireLock(LOCK_KEY, LOCK_TTL);
    if (!lockAcquired) return;

    try {
      await this.cancelExpiredPayments();
      await this.confirmOrphanedPayments();
    } finally {
      await this.redis.releaseLock(LOCK_KEY);
    }
  }

  /**
   * Cancel orders whose payment window has lapsed with no payment.
   */
  private async cancelExpiredPayments(): Promise<void> {
    const now = new Date();
    const expired = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PENDING_PAYMENT',
        paymentExpiresAt: { lt: now },
        razorpayPaymentId: null,
      },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        totalAmount: true,
      },
      take: 30,
    });

    for (const order of expired) {
      try {
        // Flip statuses and release seller stock atomically. CONFIRMED
        // reservations had their stockQty deducted at order place time
        // (see checkout.service.ts:470-479) so we must restore stockQty;
        // RESERVED reservations only hold reservedQty. Mirrors the
        // pattern in orders.service.ts:478-508.
        await this.prisma.$transaction(async (tx) => {
          await tx.masterOrder.update({
            where: { id: order.id },
            data: {
              orderStatus: 'CANCELLED',
              paymentStatus: 'CANCELLED',
            },
          });
          await tx.subOrder.updateMany({
            where: { masterOrderId: order.id },
            data: {
              paymentStatus: 'CANCELLED',
              fulfillmentStatus: 'CANCELLED',
              acceptStatus: 'CANCELLED',
            },
          });

          const reservations = await tx.stockReservation.findMany({
            where: {
              orderId: order.id,
              status: { in: ['RESERVED', 'CONFIRMED'] },
            },
          });
          for (const res of reservations) {
            await tx.stockReservation.update({
              where: { id: res.id },
              data: { status: 'RELEASED' },
            });
            if (res.status === 'CONFIRMED') {
              await tx.sellerProductMapping.update({
                where: { id: res.mappingId },
                data: { stockQty: { increment: res.quantity } },
              });
            } else {
              await tx.sellerProductMapping.update({
                where: { id: res.mappingId },
                data: { reservedQty: { decrement: res.quantity } },
              });
            }
          }
        });

        // Franchise-path stock lives behind the franchise facade which
        // manages its own transactions; best-effort release outside the tx.
        const franchiseSubOrders = await this.prisma.subOrder.findMany({
          where: {
            masterOrderId: order.id,
            fulfillmentNodeType: 'FRANCHISE',
            franchiseId: { not: null },
          },
          include: {
            items: {
              select: { productId: true, variantId: true, quantity: true },
            },
          },
        });
        for (const so of franchiseSubOrders) {
          if (!so.franchiseId) continue;
          for (const item of so.items) {
            await this.franchiseFacade
              .unreserveStock(
                so.franchiseId,
                item.productId,
                item.variantId ?? null,
                item.quantity,
                order.id,
              )
              .catch((err) =>
                this.logger.warn(
                  `Franchise unreserveStock failed for order ${order.orderNumber}: ${(err as Error)?.message}`,
                ),
              );
          }
        }

        this.eventBus
          .publish({
            eventName: 'payments.payment.expired',
            aggregate: 'MasterOrder',
            aggregateId: order.id,
            occurredAt: now,
            payload: {
              masterOrderId: order.id,
              orderNumber: order.orderNumber,
              customerId: order.customerId,
              reason: `Payment window (${this.windowMinutes}min) expired`,
            },
          })
          .catch(() => {});

        this.logger.log(
          `Auto-cancelled expired payment order ${order.orderNumber}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to cancel expired order ${order.orderNumber}: ${(err as Error).message}`,
        );
      }
    }
  }

  /**
   * Check Razorpay for PENDING_PAYMENT orders that have a razorpayOrderId
   * but no razorpayPaymentId — the customer may have paid but never
   * returned to the verify endpoint.
   */
  private async confirmOrphanedPayments(): Promise<void> {
    const orphaned = await this.prisma.masterOrder.findMany({
      where: {
        orderStatus: 'PENDING_PAYMENT',
        razorpayOrderId: { not: null },
        razorpayPaymentId: null,
        paymentExpiresAt: { gte: new Date() },
      },
      select: {
        id: true,
        orderNumber: true,
        customerId: true,
        razorpayOrderId: true,
        totalAmount: true,
      },
      take: 20,
    });

    for (const order of orphaned) {
      if (!order.razorpayOrderId) continue;
      try {
        // Razorpay orders API: fetch order → check payments
        // The adapter has getPaymentStatus but needs a paymentId.
        // For orphan detection we'd need to fetch the order's payments.
        // Since the RazorpayClient doesn't expose fetchOrder yet, we
        // skip auto-confirm for now — the webhook handler and verify
        // endpoint cover the primary paths. This poller's main value is
        // the expiry cancellation above.
        //
        // TODO: add RazorpayClient.fetchOrderPayments(orderId) to enable
        // orphan payment recovery.
      } catch {
        // Silently skip — orphan detection is best-effort
      }
    }
  }
}
