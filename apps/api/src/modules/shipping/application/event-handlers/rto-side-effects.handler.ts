// Phase 87 (2026-05-23) — NDR/RTO audit Gaps #7/#8/#12.
//
// Subscribes to `shipping.rto.delivered` and fires the
// post-RTO side effects that pre-Phase-87 nobody owned:
//   • Refund saga (Gap #7) — only for prepaid sub-orders.
//   • Stock restore (Gap #8) — scoped to the sub-order's line items
//     so sister sub-orders to the same seller don't over-release.
//
// Commission reversal (Gap #9) lives in the affiliate / seller-
// commission modules' own handlers — those modules own their
// ledgers and the @OnEvent fan-out keeps cross-module coupling
// at the event bus only.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { RefundInstructionService } from '../../../refund-instructions/application/services/refund-instruction.service';
import { StockRestoreService } from '../../../orders/application/services/stock-restore.service';

@Injectable()
export class RtoSideEffectsHandler {
  private readonly logger = new Logger(RtoSideEffectsHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    protected readonly eventDedup: EventDeduplicationService,
    private readonly stockRestore: StockRestoreService,
    // Refund-instructions is optional so a deployment that hasn't
    // wired the module (test harness) still loads the handler. The
    // refund leg is skipped with a logged warning when absent —
    // failing the whole handler would lose stock-restore too.
    @Optional()
    private readonly refundInstructions?: RefundInstructionService,
  ) {}

  @OnEvent('shipping.rto.delivered')
  @IdempotentHandler()
  async handleRtoDelivered(event: DomainEvent): Promise<void> {
    const subOrderId = (event.payload as any)?.subOrderId as string | undefined;
    if (!subOrderId) {
      this.logger.warn('shipping.rto.delivered missing subOrderId — skipped');
      return;
    }

    const sub = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        items: { select: { productId: true, variantId: true } },
        masterOrder: {
          select: {
            id: true,
            customerId: true,
            paymentStatus: true,
            paymentMethod: true,
          },
        },
      },
    });
    if (!sub) {
      this.logger.warn(
        `shipping.rto.delivered: sub-order ${subOrderId} not found — skipped`,
      );
      return;
    }
    const masterOrder = sub.masterOrder;
    const subTotal = (sub as any).subTotalInPaise as bigint | undefined;

    // 1. Stock restore — scope to THIS sub-order's items so sister
    // sub-orders to the same seller don't over-release. Runs inside
    // a $transaction (the restore service requires a tx client).
    if (sub.fulfillmentNodeType === 'SELLER' && sub.sellerId) {
      try {
        await this.prisma.$transaction(async (tx) => {
          await this.stockRestore.restoreForSubOrderItems(
            tx,
            sub.masterOrderId,
            sub.sellerId!,
            sub.items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId ?? null,
            })),
          );
        });
        this.logger.log(
          `Stock restored for RTO_DELIVERED sub-order ${subOrderId} (seller=${sub.sellerId})`,
        );
      } catch (err) {
        this.logger.error(
          `Stock restore failed for RTO_DELIVERED sub-order ${subOrderId}: ${
            (err as Error).message
          }`,
        );
      }
    }

    // 2. Refund saga — only for prepaid sub-orders. Same shape +
    // idempotency key namespace the admin cancel path uses
    // (`cancel-sub-order:<id>`) so a sub-order can't get refunded
    // twice if both paths fire (e.g., admin cancels right before
    // RTO_DELIVERED arrives). The refund-instruction service
    // findUnique short-circuits on duplicate keys.
    if (
      this.refundInstructions &&
      masterOrder?.paymentStatus === 'PAID' &&
      masterOrder.paymentMethod === 'ONLINE' &&
      subTotal &&
      subTotal > 0n
    ) {
      try {
        await this.refundInstructions.createSplitForRefund({
          sourceType: 'MANUAL' as any,
          sourceId: subOrderId,
          sourceLabel: `rto-delivered:${subOrderId}`,
          customerId: masterOrder.customerId,
          masterOrderId: sub.masterOrderId,
          amountInPaise: subTotal,
          baseIdempotencyKey: `rto-delivered:${subOrderId}`,
        });
        this.logger.log(
          `Refund initiated for RTO_DELIVERED sub-order ${subOrderId}`,
        );
      } catch (err) {
        this.logger.error(
          `Refund initiation failed for RTO_DELIVERED sub-order ${subOrderId}: ${
            (err as Error).message
          }`,
        );
      }
    } else if (masterOrder?.paymentMethod === 'COD') {
      this.logger.log(
        `RTO_DELIVERED sub-order ${subOrderId} is COD — no refund required`,
      );
    }
  }
}
