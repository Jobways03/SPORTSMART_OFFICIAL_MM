import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';

interface RefundCompletedPayload {
  returnId: string;
  returnNumber: string;
  refundAmount: number;
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
  ) {}

  @OnEvent('returns.refund.completed')
  @IdempotentHandler()
  async onRefundCompleted(event: DomainEvent<RefundCompletedPayload>): Promise<void> {
    await this.reverseFor(event.payload.returnId);
  }

  private async reverseFor(returnId: string): Promise<void> {
    try {
      const ret = await this.prisma.return.findUnique({
        where: { id: returnId },
        select: {
          id: true,
          returnNumber: true,
          subOrderId: true,
        },
      });
      if (!ret) {
        this.logger.warn(`Return ${returnId} not found for commission reversal`);
        return;
      }

      const items = await this.prisma.orderItem.findMany({
        where: { subOrderId: ret.subOrderId },
        select: { id: true },
      });
      if (items.length === 0) return;

      // Pull every commission row attached to this return's items so
      // we can decide how to reverse each (status-flip vs claw-back).
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

      // ── Pending / on-hold: flip to REFUNDED in one updateMany. ────
      const reversibleIds = records
        .filter((r) => r.status === 'PENDING' || r.status === 'ON_HOLD')
        .map((r) => r.id);
      if (reversibleIds.length > 0) {
        const result = await this.prisma.commissionRecord.updateMany({
          where: {
            id: { in: reversibleIds },
            status: { in: ['PENDING', 'ON_HOLD'] },
          },
          data: { status: 'REFUNDED' },
        });
        this.logger.log(
          `Reversed ${result.count} commission record(s) for return ${ret.returnNumber}`,
        );
      }

      // ── Settled: claw back via SellerDebit, one row per seller. ───
      // Aggregate by sellerId so a seller with multiple settled
      // commissions for the same return gets one debit (matches the
      // @@unique([sourceType, sourceId]) constraint, keyed on returnId).
      const settledBySeller = new Map<string, bigint>();
      const settledRowsBySeller = new Map<string, typeof records>();
      for (const r of records) {
        if (r.status !== 'SETTLED') continue;
        // Prefer the paise sibling; fall back to the Decimal admin
        // earning via toString (precision-safe). The platform earnings
        // (admin commission we won't collect) is the recovery amount.
        const paise =
          r.adminEarningInPaise && r.adminEarningInPaise > 0n
            ? r.adminEarningInPaise
            : this.decimalToPaise(r.adminEarning);
        const current = settledBySeller.get(r.sellerId) ?? 0n;
        settledBySeller.set(r.sellerId, current + paise);
        const rows = settledRowsBySeller.get(r.sellerId) ?? [];
        rows.push(r);
        settledRowsBySeller.set(r.sellerId, rows);
      }

      for (const [sellerId, amountInPaise] of settledBySeller.entries()) {
        if (amountInPaise <= 0n) continue;
        const firstRow = settledRowsBySeller.get(sellerId)?.[0];
        try {
          // `SellerDebit @@unique([sourceType, sourceId])` —
          // returnId (not a per-row id) is the natural key for "the
          // return that triggered this claw-back". One debit per
          // (return, seller). Replays / duplicate events fail with
          // P2002 and are silently absorbed.
          await this.prisma.sellerDebit.create({
            data: {
              sellerId,
              sourceType: 'RETURN',
              sourceId: returnId,
              orderId: firstRow?.masterOrderId ?? null,
              subOrderId: firstRow?.subOrderId ?? null,
              amountInPaise,
              reason: `POST_SETTLEMENT_RETURN: claw-back for return ${ret.returnNumber}`,
            },
          });
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
        } catch (err: any) {
          // P2002 = unique constraint hit; treat as idempotent no-op.
          if (err?.code === 'P2002') {
            this.logger.debug(
              `SellerDebit for return ${ret.returnNumber} seller ${sellerId} already exists`,
            );
            continue;
          }
          this.logger.error(
            `Failed to record SellerDebit for return ${ret.returnNumber} seller ${sellerId}: ${err?.message ?? err}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `Commission reversal for ${returnId} failed: ${(err as Error).message}`,
      );
    }
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
