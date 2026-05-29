import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';

interface RefundCompletedPayload {
  returnId: string;
  returnNumber: string;
  refundAmount: number;
}

interface RtoDeliveredPayload {
  subOrderId: string;
  awb?: string;
  carrier?: string;
}

/**
 * When a customer's refund completes, reverse the seller's commission
 * on the returned items so the next seller settlement deducts the
 * commission we won't collect.
 *
 * Resolution path:
 *   Return → SubOrder → OrderItems → CommissionRecord(s) by orderItemId.
 *
 * Phase 0 (PR 0.11) — corrections to the previous handler:
 *
 *   1. **Single event subscription.** Subscribing to BOTH
 *      `returns.return.approved` AND `returns.refund.completed` for the
 *      same logical action double-fired the reversal. The first call
 *      flipped PENDING/ON_HOLD → REFUNDED; the second saw nothing to
 *      flip and silently returned 0. That worked by accident — and only
 *      until SETTLED-handling was added below, at which point a SETTLED
 *      record could have been clawed back twice. We now subscribe to
 *      `returns.refund.completed` only: this is the canonical signal
 *      that the customer has actually received their money. Commissions
 *      that don't survive to refund-completed (e.g. a return cancelled
 *      mid-pickup) keep their PENDING/ON_HOLD status, which is correct.
 *
 *   2. **`@IdempotentHandler` against event_deduplication.** Even with a
 *      single subscription, the publisher delivers at-least-once and
 *      replay tooling can re-emit any event. Wrap so this handler
 *      cannot reverse the same commission twice on a replay.
 *
 *   3. **Post-settlement claw-back via SellerDebit.** When a commission
 *      is already SETTLED (seller has been paid), we cannot flip the
 *      status row backwards — the bank transfer already happened. The
 *      old code silently skipped these. We now write a `SellerDebit`
 *      row keyed on `(RETURN, returnId)` so the next settlement cycle
 *      can deduct the recovered commission from the seller's payout.
 *      The `@@unique([sourceType, sourceId])` constraint on SellerDebit
 *      is our backstop against replay-driven double-debits, layered
 *      with (2) for defence in depth.
 *
 *   4. **Audit event.** `commission.post_settlement_reversal_recorded`
 *      fires when a SellerDebit is written, so the audit log /
 *      notifications surface every post-settlement claw-back to ops.
 */
@Injectable()
export class CommissionReversalHandler {
  private readonly logger = new Logger(CommissionReversalHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBusService,
    // Accessible (not private) so the `@IdempotentHandler` decorator
    // can find this field on `this` at runtime.
    protected readonly eventDedup: EventDeduplicationService,
    // Phase 150 — @Global AuditPublicFacade; @Optional so the unit spec can
    // construct the handler with three args (audit is a best-effort sink).
    @Optional() private readonly audit?: AuditPublicFacade,
  ) {}

  @OnEvent('returns.refund.completed')
  @IdempotentHandler()
  async onRefundCompleted(event: DomainEvent<RefundCompletedPayload>): Promise<void> {
    await this.reverseFor(event.payload.returnId);
  }

  /**
   * Phase 87 (2026-05-23) — NDR/RTO audit Gap #9. RTO_DELIVERED on
   * a sub-order is a deemed cancellation: seller's commission
   * must reverse. Same shape as `onRefundCompleted` but the source
   * id is the sub-order (no Return row exists for RTOs). The
   * SellerDebit unique constraint keys on (sourceType, sourceId)
   * so re-emission is absorbed by P2002.
   */
  @OnEvent('shipping.rto.delivered')
  @IdempotentHandler()
  async onShippingRtoDelivered(
    event: DomainEvent<RtoDeliveredPayload>,
  ): Promise<void> {
    await this.reverseForSubOrder(event.payload.subOrderId);
  }

  private async reverseForSubOrder(subOrderId: string): Promise<void> {
    try {
      const sub = await this.prisma.subOrder.findUnique({
        where: { id: subOrderId },
        select: { id: true, masterOrderId: true },
      });
      if (!sub) {
        this.logger.warn(
          `Sub-order ${subOrderId} not found for RTO commission reversal`,
        );
        return;
      }

      const items = await this.prisma.orderItem.findMany({
        where: { subOrderId },
        select: { id: true },
      });
      if (items.length === 0) return;

      const records = await this.prisma.commissionRecord.findMany({
        where: { orderItemId: { in: items.map((i) => i.id) } },
        select: {
          id: true,
          sellerId: true,
          subOrderId: true,
          masterOrderId: true,
          status: true,
          adminEarningInPaise: true,
          adminEarning: true,
          totalCommissionInPaise: true,
        },
      });
      if (records.length === 0) return;

      // RTO = whole sub-order returned to origin (no partial), so the full
      // line reverses for every item — no per-quantity proration needed.
      const flipIds = records
        .filter((r) => r.status === 'PENDING' || r.status === 'ON_HOLD')
        .map((r) => r.id);

      const settledBySeller = new Map<string, bigint>();
      for (const r of records) {
        if (r.status !== 'SETTLED') continue;
        const paise =
          r.adminEarningInPaise && r.adminEarningInPaise > 0n
            ? r.adminEarningInPaise
            : this.decimalToPaise(r.adminEarning);
        settledBySeller.set(
          r.sellerId,
          (settledBySeller.get(r.sellerId) ?? 0n) + paise,
        );
      }

      // Pre-check existing (RTO, subOrderId) debits — see reverseFor for why
      // we can't catch P2002 inside the transaction.
      const existing = await this.prisma.sellerDebit.findMany({
        where: { sourceType: 'RTO', sourceId: subOrderId },
        select: { sellerId: true },
      });
      const alreadyDebited = new Set(existing.map((d) => d.sellerId));

      // ── Atomic: flip + debit creates in one transaction (audit #4).
      const created: Array<{ sellerId: string; amountInPaise: bigint }> = [];
      await this.prisma.$transaction(async (tx) => {
        if (flipIds.length > 0) {
          const result = await tx.commissionRecord.updateMany({
            where: {
              id: { in: flipIds },
              status: { in: ['PENDING', 'ON_HOLD'] },
            },
            data: { status: 'REFUNDED' },
          });
          this.logger.log(
            `Reversed ${result.count} commission record(s) for RTO sub-order ${subOrderId}`,
          );
        }
        for (const [sellerId, amountInPaise] of settledBySeller.entries()) {
          if (amountInPaise <= 0n || alreadyDebited.has(sellerId)) continue;
          await tx.sellerDebit.create({
            data: {
              sellerId,
              // Distinct source type so the SellerDebit unique key doesn't
              // collide with the Return-driven reversal.
              sourceType: 'RTO',
              sourceId: subOrderId,
              // Phase 150 — null granular ids (aggregated per seller).
              orderId: null,
              subOrderId: null,
              amountInPaise,
              reason: `POST_SETTLEMENT_RTO: claw-back for sub-order ${subOrderId}`,
            } as any,
          });
          created.push({ sellerId, amountInPaise });
        }
      });

      // ── Post-commit, best-effort: event + audit per created debit.
      for (const { sellerId, amountInPaise } of created) {
        this.logger.log(
          `Recorded SellerDebit for seller ${sellerId} via RTO: ${amountInPaise} paise (sub-order ${subOrderId})`,
        );
        await this.eventBus
          .publish({
            eventName: 'commission.post_settlement_reversal_recorded',
            aggregate: 'SubOrder',
            aggregateId: subOrderId,
            occurredAt: new Date(),
            payload: {
              subOrderId,
              masterOrderId: sub.masterOrderId,
              sellerId,
              amountInPaise: amountInPaise.toString(),
              source: 'RTO_DELIVERED',
            },
          })
          .catch(() => undefined);
        await this.writeDebitAudit({
          sellerId,
          sourceType: 'RTO',
          sourceId: subOrderId,
          amountInPaise,
          reason: `RTO sub-order ${subOrderId}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `RTO commission reversal for sub-order ${subOrderId} failed: ${
          (err as Error).message
        }`,
      );
    }
  }

  private async reverseFor(returnId: string): Promise<void> {
    try {
      const ret = await this.prisma.return.findUnique({
        where: { id: returnId },
        select: {
          id: true,
          returnNumber: true,
          subOrderId: true,
          // Phase 150 — per-item returned quantity, so the reversal is scoped
          // to the items ACTUALLY returned (not the whole sub-order) and the
          // claw-back is proportional to the returned quantity.
          items: {
            select: {
              orderItemId: true,
              quantity: true,
              qcQuantityApproved: true,
            },
          },
        },
      });
      if (!ret) {
        this.logger.warn(`Return ${returnId} not found for commission reversal`);
        return;
      }

      // orderItemId → returned qty. After QC, qcQuantityApproved is
      // authoritative; fall back to the requested quantity for the (rare)
      // pre-QC refund path. Items with 0 approved qty are skipped.
      const returnedQtyByItem = new Map<string, number>();
      for (const it of ret.items ?? []) {
        const qty = it.qcQuantityApproved ?? it.quantity ?? 0;
        if (qty > 0) {
          returnedQtyByItem.set(
            it.orderItemId,
            (returnedQtyByItem.get(it.orderItemId) ?? 0) + qty,
          );
        }
      }
      const returnedItemIds = Array.from(returnedQtyByItem.keys());
      if (returnedItemIds.length === 0) return;

      // Commission rows for the RETURNED items only (Phase 150 — was every
      // item on the sub-order, which over-reversed a partial return).
      const records = await this.prisma.commissionRecord.findMany({
        where: { orderItemId: { in: returnedItemIds } },
        select: {
          id: true,
          sellerId: true,
          orderItemId: true,
          status: true,
          quantity: true,
          adminEarningInPaise: true,
          adminEarning: true,
        },
      });
      if (records.length === 0) return;

      // Records to flip PENDING/ON_HOLD → REFUNDED — only when the FULL
      // quantity was returned. A partial return leaves the row PENDING: the
      // proportional pre-settlement reversal is owned by
      // ReturnCommissionReversalService (it lowers refundedAdminEarning and
      // keeps the row PENDING so the seller still earns on the unreturned part).
      const flipIds: string[] = [];
      // Per-seller claw-back accumulator (settled rows only, proportional).
      const settledBySeller = new Map<string, bigint>();

      for (const r of records) {
        const returnedQty = returnedQtyByItem.get(r.orderItemId) ?? 0;
        const totalQty = r.quantity > 0 ? r.quantity : returnedQty;
        const fullyReturned = totalQty > 0 && returnedQty >= totalQty;

        if (r.status === 'PENDING' || r.status === 'ON_HOLD') {
          if (fullyReturned) flipIds.push(r.id);
          continue;
        }
        if (r.status !== 'SETTLED') continue;

        // Proportional claw-back: adminEarning × returnedQty / totalQty,
        // clamped to the row's admin earning. Recovers exactly the platform
        // commission on the returned units — not the whole line (audit #8).
        const grossPaise =
          r.adminEarningInPaise && r.adminEarningInPaise > 0n
            ? r.adminEarningInPaise
            : this.decimalToPaise(r.adminEarning);
        if (grossPaise <= 0n || totalQty <= 0) continue;
        let clawPaise =
          returnedQty >= totalQty
            ? grossPaise
            : (grossPaise * BigInt(returnedQty)) / BigInt(totalQty);
        if (clawPaise > grossPaise) clawPaise = grossPaise;
        if (clawPaise <= 0n) continue;
        settledBySeller.set(
          r.sellerId,
          (settledBySeller.get(r.sellerId) ?? 0n) + clawPaise,
        );
      }

      // Pre-check existing (RETURN, returnId) debits so the in-transaction
      // creates below never hit P2002 on the common replay path — a P2002
      // *inside* a PG transaction aborts the whole transaction, so we can't
      // catch-and-continue once we're atomic. @IdempotentHandler is the outer
      // guard; this is the belt-and-braces second layer.
      const existing = await this.prisma.sellerDebit.findMany({
        where: { sourceType: 'RETURN', sourceId: returnId },
        select: { sellerId: true },
      });
      const alreadyDebited = new Set(existing.map((d) => d.sellerId));

      // ── Atomic: status flip + all SellerDebit creates in one transaction
      // (audit #4). A mid-loop failure previously left some rows REFUNDED with
      // no debit recorded for another seller. Event + audit fire AFTER commit.
      const created: Array<{ sellerId: string; amountInPaise: bigint }> = [];
      await this.prisma.$transaction(async (tx) => {
        if (flipIds.length > 0) {
          const result = await tx.commissionRecord.updateMany({
            where: {
              id: { in: flipIds },
              status: { in: ['PENDING', 'ON_HOLD'] },
            },
            data: { status: 'REFUNDED' },
          });
          this.logger.log(
            `Reversed ${result.count} fully-returned commission record(s) for return ${ret.returnNumber}`,
          );
        }
        for (const [sellerId, amountInPaise] of settledBySeller.entries()) {
          if (amountInPaise <= 0n || alreadyDebited.has(sellerId)) continue;
          await tx.sellerDebit.create({
            data: {
              sellerId,
              sourceType: 'RETURN',
              sourceId: returnId,
              // Phase 150 — aggregated across the seller's returned items
              // (possibly several sub-orders), so a single order/sub-order id
              // would be misleading. (sourceType, sourceId)=returnId + the
              // reason text carry the provenance.
              orderId: null,
              subOrderId: null,
              amountInPaise,
              reason: `POST_SETTLEMENT_RETURN: claw-back for return ${ret.returnNumber}`,
            },
          });
          created.push({ sellerId, amountInPaise });
        }
      });

      // ── Post-commit, best-effort: domain event + audit per created debit.
      for (const { sellerId, amountInPaise } of created) {
        this.logger.log(
          `Recorded SellerDebit for seller ${sellerId}: ${amountInPaise} paise (return ${ret.returnNumber})`,
        );
        await this.eventBus
          .publish({
            eventName: 'commission.post_settlement_reversal_recorded',
            aggregate: 'Return',
            aggregateId: returnId,
            occurredAt: new Date(),
            payload: {
              returnId,
              returnNumber: ret.returnNumber,
              sellerId,
              amountInPaise: amountInPaise.toString(),
            },
          })
          .catch(() => undefined);
        await this.writeDebitAudit({
          sellerId,
          sourceType: 'RETURN',
          sourceId: returnId,
          amountInPaise,
          reason: `Return ${ret.returnNumber}`,
        });
      }
    } catch (err) {
      this.logger.error(
        `Commission reversal for ${returnId} failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Phase 150 — best-effort audit row for a post-settlement claw-back, written
   * after the debit commits. Mirrors the rich audit on mark-paid (#111). No-op
   * when the facade isn't wired (the unit spec constructs without it).
   */
  private async writeDebitAudit(args: {
    sellerId: string;
    sourceType: string;
    sourceId: string;
    amountInPaise: bigint;
    reason: string;
  }): Promise<void> {
    if (!this.audit) return;
    await this.audit
      .writeAuditLog({
        actorId: 'system',
        actorRole: 'SYSTEM',
        action: 'commission.post_settlement_reversal_recorded',
        module: 'commission',
        resource: 'seller_debit',
        resourceId: `${args.sourceType}:${args.sourceId}`,
        newValue: {
          sellerId: args.sellerId,
          amountInPaise: args.amountInPaise.toString(),
          reason: args.reason,
        },
      })
      .catch((e) =>
        this.logger.error(`Failed to audit seller debit: ${e}`),
      );
  }

  /**
   * Decimal → bigint paise via the precision-safe path (PR 0.4).
   * Used only as a fallback for legacy commission rows where the
   * paise sibling column hasn't been backfilled yet.
   */
  private decimalToPaise(decimal: unknown): bigint {
    if (decimal === null || decimal === undefined) return 0n;
    const d = decimal as { mul?: (n: number) => unknown; toFixed?: (n: number) => string };
    if (typeof d.mul === 'function' && typeof d.toFixed === 'function') {
      const scaled = d.mul(100) as { toFixed: (n: number) => string };
      return BigInt(scaled.toFixed(0));
    }
    if (typeof decimal === 'string') {
      // String form — re-route through the same logic by stripping
      // the decimal point. Conservative: pad/truncate to 2 digits.
      const trimmed = decimal.trim();
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return 0n;
      const negative = trimmed.startsWith('-');
      const u = negative ? trimmed.slice(1) : trimmed;
      const [i, f = ''] = u.split('.');
      const fPadded = (f + '00').slice(0, 2);
      const paise = BigInt((i + fPadded).replace(/^0+(?=\d)/, '') || '0');
      return negative ? -paise : paise;
    }
    return 0n;
  }
}
