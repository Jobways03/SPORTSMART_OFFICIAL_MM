import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { RefundInstructionService } from '../../../refund-instructions/application/services/refund-instruction.service';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import {
  classifyExchangePriceDiff,
  classifyStockAvailability,
  resolveReplacementOrExchange,
} from './replacement-exchange-classifier';

/**
 * Phase 13 (P1.14) — replacement / exchange order creation.
 *
 * Called from `ReturnService.submitQcDecision` immediately after a QC
 * decision picks REPLACEMENT or EXCHANGE. Best-effort: a failure here
 * (stock lookup down, order-number sequence contention, etc.) does
 * NOT roll back the QC decision — the return stays at
 * `replacementStatus = PENDING_STOCK_CHECK` and an AdminTask is
 * enqueued so ops can retry.
 *
 * Money-flow rules (mirrors the spec):
 *   REPLACEMENT (same SKU, in stock)         → ₹0 order, status AWAITING_FULFILMENT
 *   REPLACEMENT (out of stock)               → status FALLBACK_TO_REFUND, normal refund
 *   EXCHANGE (same price, in stock)          → ₹0 order, status AWAITING_FULFILMENT
 *   EXCHANGE (cheaper, in stock)             → ₹0 order + partial RefundInstruction for diff
 *   EXCHANGE (pricier, in stock)             → status AWAITING_PAYMENT (admin/customer settles diff)
 *   EXCHANGE (out of stock)                  → FALLBACK_TO_REFUND
 *
 * Stock decrement runs INSIDE the same transaction as the order
 * creation so an in-flight stock-out at order-create time aborts
 * the whole flow cleanly (the FALLBACK path takes over via the
 * caller's retry logic, not a half-finished order row).
 *
 * EXCHANGE flow notes:
 *   - The replacement-target variant is read from
 *     `Return.exchangeTargetVariantId` (set by admin at QC time).
 *   - For now, EXCHANGE is sketched but the COLLECT_FROM_CUSTOMER
 *     payment-collection path is intentionally a no-op — wires for
 *     the checkout integration land in a follow-up.
 */
@Injectable()
export class ReplacementOrderService {
  private readonly logger = new Logger(ReplacementOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditPublicFacade,
    private readonly ledger: LiabilityLedgerPublicFacade,
    private readonly eventBus: EventBusService,
    // Phase 13 (P1.14) — used by the EXCHANGE+REFUND_TO_CUSTOMER path
    // to mint a partial RefundInstruction for the price diff. Distinct
    // idempotency key (`return:<id>:exchange-diff`) so it doesn't
    // collide with the main refund key (`return:<id>`) — the latter
    // is the wallet-credit-this-return key, the former is "give back
    // the difference between the original and replacement SKU".
    private readonly refundInstructions: RefundInstructionService,
    // Phase 7 (PR 7.4) — paise-sibling dual-write for the replacement
    // master/sub/item rows created at ₹0. The Decimal source is the
    // single source of truth; the helper computes the paise sibling so
    // the manual `*InPaise: 0n` lines stay consistent automatically.
    private readonly moneyDualWrite: MoneyDualWriteHelper,
  ) {}

  /**
   * Process a return whose QC decision picked REPLACEMENT/EXCHANGE.
   * Returns the new replacement-order id (when created) or null when
   * the path fell back to a refund or stalled awaiting payment.
   *
   * Idempotent: repeated calls on a return that already has a
   * `replacementOrderId` no-op and return the existing order id.
   */
  async processReturn(
    returnId: string,
  ): Promise<{ replacementOrderId: string | null; status: string } | null> {
    const ret = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        items: { include: { orderItem: true } },
        masterOrder: { select: { shippingAddressSnapshot: true, customerId: true } },
        subOrder: { select: { sellerId: true, fulfillmentNodeType: true } },
      },
    });
    if (!ret) {
      this.logger.warn(`processReturn: return ${returnId} not found`);
      return null;
    }
    if (
      ret.customerRemedy !== 'REPLACEMENT' &&
      ret.customerRemedy !== 'EXCHANGE'
    ) {
      // Not a replacement-bound return — caller mis-routed; no-op.
      return null;
    }
    if (ret.replacementOrderId) {
      // Already processed.
      return {
        replacementOrderId: ret.replacementOrderId,
        status: ret.replacementStatus ?? 'AWAITING_FULFILMENT',
      };
    }

    // The return must be linked to a single concrete item to know
    // what to ship next. The current schema/UX is one-item-per-return
    // for replacement / exchange (assertReturnDecisionMatrix already
    // enforces QC_APPROVED, which means all items approved). If the
    // return has multiple items we ship a replacement for each.
    if (ret.items.length === 0) {
      throw new Error(
        `Return ${returnId} has no items — cannot process replacement`,
      );
    }

    // For the REPLACEMENT path, target variant = original variant.
    // For EXCHANGE, target variant = exchangeTargetVariantId.
    const isExchange = ret.customerRemedy === 'EXCHANGE';
    const targetVariantId = isExchange
      ? ret.exchangeTargetVariantId
      : ret.items[0]!.orderItem.variantId;
    if (!targetVariantId) {
      throw new Error(
        isExchange
          ? `Return ${returnId} is EXCHANGE but exchangeTargetVariantId is null — admin must pick a target`
          : `Return ${returnId} item has no variant — cannot ship replacement`,
      );
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: targetVariantId },
      select: {
        id: true,
        productId: true,
        price: true,
        stock: true,
        sku: true,
        title: true,
      },
    });
    if (!variant) {
      throw new Error(
        `Variant ${targetVariantId} not found — cannot create replacement order`,
      );
    }

    const totalQuantity = ret.items.reduce((s, it) => s + it.quantity, 0);
    const availability = classifyStockAvailability({
      availableStock: variant.stock,
      requestedQuantity: totalQuantity,
    });

    // Compute the exchange resolution (or trivial REPLACEMENT case).
    const priceDiff = isExchange
      ? classifyExchangePriceDiff({
          originalPaise: Math.round(
            Number(ret.items[0]!.orderItem.unitPrice) * 100,
          ),
          replacementPaise: Math.round(Number(variant.price) * 100),
        })
      : undefined;
    const resolution = resolveReplacementOrExchange({
      remedy: isExchange ? 'EXCHANGE' : 'REPLACEMENT',
      availability,
      priceDiff,
    });

    if (resolution.kind === 'FALLBACK_TO_REFUND') {
      return this.fallbackToRefund(ret, resolution.replacementStatus);
    }

    if (resolution.kind === 'AWAIT_PAYMENT') {
      // Phase 13 (P1.14 follow-up) — if the customer already paid the
      // diff via the exchange-payment Razorpay flow, treat it as
      // PROCEED. The price-up exchange is now fully funded and the
      // replacement order can ship at ₹0 (the diff money is already
      // in our books separately).
      if (ret.exchangePaymentCompletedAt) {
        const proceedResolution: ReturnType<
          typeof resolveReplacementOrExchange
        > = {
          kind: 'PROCEED',
          replacementStatus: 'AWAITING_FULFILMENT',
        };
        return this.createReplacementOrder(
          ret,
          variant,
          totalQuantity,
          proceedResolution,
        );
      }
      return this.awaitPayment(
        ret,
        resolution.replacementStatus,
        resolution.priceDiff!.diffInPaise,
      );
    }

    // PROCEED or PROCEED_WITH_PARTIAL_REFUND — both create the
    // replacement order. The latter additionally mints a partial
    // RefundInstruction for the price diff after the order is created.
    return this.createReplacementOrder(ret, variant, totalQuantity, resolution);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private async fallbackToRefund(
    ret: any,
    newStatus: 'FALLBACK_TO_REFUND',
  ): Promise<{ replacementOrderId: null; status: string }> {
    await this.prisma.return.update({
      where: { id: ret.id },
      data: { replacementStatus: newStatus as any },
    });
    this.logger.log(
      `Return ${ret.returnNumber}: replacement target out of stock — flipped to FALLBACK_TO_REFUND`,
    );
    // Enqueue an admin task so finance/ops actions the refund. We
    // don't auto-create the RefundInstruction here because the
    // remedy column is REPLACEMENT/EXCHANGE — finance needs to
    // explicitly decide whether to refund or wait for restock.
    await this.ledger
      .enqueueAdminTask({
        kind: 'OTHER' as any,
        sourceType: 'RETURN' as any,
        sourceId: ret.id,
        reason: `Replacement target out of stock for return ${ret.returnNumber}; ops must decide refund vs. wait for restock`,
      })
      .catch(() => undefined);
    this.audit
      .writeAuditLog({
        action: 'return.replacement_fallback_to_refund',
        module: 'returns',
        resource: 'return',
        resourceId: ret.id,
        oldValue: { replacementStatus: 'PENDING_STOCK_CHECK' },
        newValue: { replacementStatus: newStatus },
      })
      .catch(() => undefined);
    return { replacementOrderId: null, status: newStatus };
  }

  private async awaitPayment(
    ret: any,
    newStatus: 'AWAITING_PAYMENT',
    diffInPaise: number,
  ): Promise<{ replacementOrderId: null; status: string }> {
    await this.prisma.return.update({
      where: { id: ret.id },
      data: {
        replacementStatus: newStatus as any,
        exchangePriceDiffPaise: BigInt(diffInPaise),
      },
    });
    // TODO(payment-integration): emit an event the customer's app
    // can listen to and surface a "pay ₹X to complete your exchange"
    // flow. For now an AdminTask covers the manual ops path.
    await this.ledger
      .enqueueAdminTask({
        kind: 'OTHER' as any,
        sourceType: 'RETURN' as any,
        sourceId: ret.id,
        reason: `Return ${ret.returnNumber} exchange requires customer to pay ₹${(diffInPaise / 100).toFixed(2)} difference`,
      })
      .catch(() => undefined);
    this.audit
      .writeAuditLog({
        action: 'return.replacement_awaiting_payment',
        module: 'returns',
        resource: 'return',
        resourceId: ret.id,
        oldValue: { replacementStatus: 'PENDING_STOCK_CHECK' },
        newValue: { replacementStatus: newStatus, diffInPaise },
      })
      .catch(() => undefined);
    return { replacementOrderId: null, status: newStatus };
  }

  private async createReplacementOrder(
    ret: any,
    variant: { id: string; productId: string; price: any; stock: number; sku: string | null; title: string | null },
    totalQuantity: number,
    resolution: ReturnType<typeof resolveReplacementOrExchange>,
  ): Promise<{ replacementOrderId: string; status: string }> {
    if (
      resolution &&
      resolution.kind !== 'PROCEED' &&
      resolution.kind !== 'PROCEED_WITH_PARTIAL_REFUND'
    ) {
      throw new Error(
        `createReplacementOrder called with non-proceed resolution: ${resolution.kind}`,
      );
    }
    const replacementStatus = resolution!.replacementStatus;

    const orderId = await this.prisma.$transaction(async (tx) => {
      // Re-check stock under the transaction's snapshot — defends
      // against a concurrent purchase that drained inventory between
      // the eligibility check and now. If stock is gone, throw and
      // let the caller route to fallback on retry.
      const v = await tx.productVariant.findUnique({
        where: { id: variant.id },
        select: { stock: true },
      });
      if (!v || v.stock < totalQuantity) {
        throw new Error('STOCK_RACE');
      }

      // Decrement stock atomically.
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: { decrement: totalQuantity } },
      });

      // Generate replacement order number.
      const seq = await tx.orderSequence.upsert({
        where: { id: 1 },
        create: { id: 1, lastNumber: 1 },
        update: { lastNumber: { increment: 1 } },
      });
      const year = new Date().getFullYear();
      const orderNumber = `SM${year}${String(seq.lastNumber).padStart(4, '0')}-R`;

      // Create the replacement order at ₹0 — the customer is paying
      // nothing now (price-diff cases are gated to AWAITING_PAYMENT
      // earlier). Mark as PAID so it skips checkout-side payment
      // collection.
      const masterOrder = await tx.masterOrder.create({
        data: this.moneyDualWrite.applyPaise('masterOrder', {
          orderNumber,
          customerId: ret.customerId,
          shippingAddressSnapshot: ret.masterOrder.shippingAddressSnapshot,
          totalAmount: 0,
          itemCount: totalQuantity,
          paymentMethod: 'COD' as any,
          paymentStatus: 'PAID' as any,
          orderStatus: 'PLACED' as any,
        }),
      });

      const subOrder = await tx.subOrder.create({
        data: this.moneyDualWrite.applyPaise('subOrder', {
          masterOrderId: masterOrder.id,
          sellerId: ret.subOrder.sellerId,
          fulfillmentNodeType: ret.subOrder.fulfillmentNodeType ?? 'SELLER',
          subTotal: 0,
          paymentStatus: 'PAID' as any,
          fulfillmentStatus: 'UNFULFILLED' as any,
          acceptStatus: 'OPEN' as any,
        }),
      });

      await tx.orderItem.create({
        data: this.moneyDualWrite.applyPaise('orderItem', {
          subOrderId: subOrder.id,
          productId: variant.productId,
          variantId: variant.id,
          productTitle: variant.title ?? 'Replacement item',
          sku: variant.sku,
          quantity: totalQuantity,
          unitPrice: 0,
          totalPrice: 0,
        }),
      });

      // Stamp the replacement-order pointer + status on the return.
      await tx.return.update({
        where: { id: ret.id },
        data: {
          replacementOrderId: masterOrder.id,
          replacementStatus: replacementStatus as any,
        },
      });

      return masterOrder.id;
    });

    // PROCEED_WITH_PARTIAL_REFUND — mint a partial RefundInstruction
    // for the price-diff after the order is committed. Distinct
    // idempotency key (`return:<id>:exchange-diff`) so retries don't
    // collide with the main refund-flow key (`return:<id>`). Best-
    // effort: a failure here doesn't roll back the order — the order
    // is already valid; a missing partial refund surfaces via
    // AdminTask for ops to action.
    if (resolution!.kind === 'PROCEED_WITH_PARTIAL_REFUND') {
      const diffInPaise = (resolution as any).priceDiff?.diffInPaise ?? 0;
      try {
        await this.refundInstructions.createForReturn({
          returnId: ret.id,
          returnNumber: ret.returnNumber,
          customerId: ret.customerId,
          masterOrderId: ret.masterOrderId,
          amountInPaise: diffInPaise,
          refundMethod: 'WALLET',
          idempotencyKey: `return:${ret.id}:exchange-diff`,
        });
        this.logger.log(
          `Return ${ret.returnNumber}: minted partial RefundInstruction for ₹${(diffInPaise / 100).toFixed(2)} exchange diff`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to mint partial refund for exchange diff on return ${ret.returnNumber}: ${(err as Error).message}`,
        );
        await this.ledger
          .enqueueAdminTask({
            kind: 'OTHER' as any,
            sourceType: 'RETURN' as any,
            sourceId: ret.id,
            reason: `Return ${ret.returnNumber} exchange — manual refund needed for ₹${(diffInPaise / 100).toFixed(2)} diff (auto-mint failed: ${(err as Error).message})`,
          })
          .catch(() => undefined);
      }
    }

    try {
      await this.eventBus.publish({
        eventName: 'returns.replacement.created',
        aggregate: 'Return',
        aggregateId: ret.id,
        occurredAt: new Date(),
        payload: {
          returnId: ret.id,
          returnNumber: ret.returnNumber,
          replacementOrderId: orderId,
          replacementStatus,
        },
      });
    } catch {/* events are best-effort */}

    this.audit
      .writeAuditLog({
        action: 'return.replacement_order_created',
        module: 'returns',
        resource: 'return',
        resourceId: ret.id,
        newValue: {
          replacementOrderId: orderId,
          replacementStatus,
        },
        metadata: { returnNumber: ret.returnNumber, variantId: variant.id },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber}: replacement order ${orderId} created (${replacementStatus})`,
    );

    return { replacementOrderId: orderId, status: replacementStatus };
  }
}
