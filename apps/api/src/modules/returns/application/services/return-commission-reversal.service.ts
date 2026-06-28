import { Injectable } from '@nestjs/common';
import { CommissionRecordStatus, CommissionReversalSource, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { BadRequestAppException } from '../../../../core/exceptions';
import { FranchisePublicFacade } from '../../../franchise/application/facades/franchise-public.facade';

type PrismaLike = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ReturnCommissionReversalService {
  private readonly reversalWindowDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly franchiseFacade: FranchisePublicFacade,
    private readonly logger: AppLoggerService,
    private readonly envService: EnvService,
  ) {
    this.logger.setContext('ReturnCommissionReversalService');
    this.reversalWindowDays = this.envService.getNumber(
      'COMMISSION_REVERSAL_WINDOW_DAYS',
      30,
    );
  }

  /**
   * Guard: once a settlement has been paid, stop allowing commission
   * reversals N days later. Keeps the ledger reconcilable with
   * already-disbursed bank transfers. 0 disables the check.
   */
  private assertWithinReversalWindow(paidAt: Date | null | undefined, context: string) {
    if (!paidAt || this.reversalWindowDays <= 0) return;
    const windowEnd =
      new Date(paidAt).getTime() + this.reversalWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() > windowEnd) {
      throw new BadRequestAppException(
        `${context}: the linked settlement was paid on ${new Date(paidAt).toISOString()} and the ${this.reversalWindowDays}-day reversal window has lapsed. Use a manual adjustment instead.`,
      );
    }
  }

  /**
   * Per-item partial-VALUE fraction (0..1). Set by the QC step when an
   * admin refunds only part of an item's value; defaults to 1 (full) for
   * every normal full-quantity / partial-quantity reversal. Scales both
   * the customer refund and the seller commission clawback so a partial
   * refund only claws back a proportional slice of the margin.
   */
  private valueFractionOf(item: any): number {
    const f = item?.refundValueFraction;
    return typeof f === 'number' && f >= 0 && f <= 1 ? f : 1;
  }

  /**
   * Calculate refund amount and reverse commission proportionally.
   * Returns total refund amount (sum of approvedQty * unitPrice across all items).
   *
   * When `tx` is provided, seller-path commission record updates run inside
   * that transaction so they're atomic with the surrounding return update.
   * Franchise-path calls use the franchise facade and execute in their own
   * internal transactions regardless of `tx`.
   */
  async reverseCommissionForReturn(
    returnRecord: any,
    tx?: Prisma.TransactionClient,
    opts?: {
      source?: CommissionReversalSource;
      actorType?: string;
      actorId?: string | null;
      note?: string;
    },
  ): Promise<number> {
    const subOrder = returnRecord?.subOrder;
    if (!subOrder) {
      throw new BadRequestAppException('Sub-order not loaded with return');
    }

    const isFranchise = subOrder.fulfillmentNodeType === 'FRANCHISE';
    const db: PrismaLike = tx ?? this.prisma;

    // Calculate refund amount: sum of (qcQuantityApproved * unitPrice) per item.
    // Uses Prisma.Decimal so multiple items (each with fractional unit prices)
    // can be summed without float drift. `unitPrice` already comes off the DB
    // as Decimal; keeping the accumulator in Decimal preserves precision.
    let totalRefund = new Prisma.Decimal(0);
    for (const item of returnRecord.items) {
      const orderItem = item.orderItem;
      if (!orderItem) continue;
      const approvedQty = item.qcQuantityApproved || 0;
      const valueFraction = this.valueFractionOf(item);
      totalRefund = totalRefund.add(
        new Prisma.Decimal(orderItem.unitPrice)
          .mul(approvedQty)
          .mul(valueFraction),
      );
    }

    // Round to 2 decimals for persistence / display.
    const totalRefundAmount = totalRefund
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();

    if (totalRefundAmount === 0) {
      this.logger.log(
        `No refund amount for return ${returnRecord.returnNumber} — skipping commission reversal`,
      );
      return 0;
    }

    if (isFranchise) {
      // Late-reversal guard: if the commission has already been bundled into
      // a paid settlement, only allow reversals within the configured window.
      const originalLedger = await this.prisma.franchiseFinanceLedger.findFirst({
        where: {
          franchiseId: subOrder.franchiseId,
          sourceId: subOrder.id,
          sourceType: 'ONLINE_ORDER',
        },
        include: { settlementBatch: { select: { paidAt: true } } },
        orderBy: { createdAt: 'desc' },
      });
      this.assertWithinReversalWindow(
        originalLedger?.settlementBatch?.paidAt ?? null,
        `Return ${returnRecord.returnNumber} for franchise sub-order ${subOrder.id}`,
      );

      // Reverse the franchise's ACTUAL EARNING, scaled to the value returned —
      // NOT the gross customer refund. `totalRefundAmount` is the GST-inclusive
      // customer price (unitPrice × qty); it bundles the 18% GST and the
      // platform's commission, NEITHER of which the franchise was ever credited
      // (recordOnlineOrderCommission credits only the net franchiseEarning, e.g.
      // ₹654.78 on a ₹909 gross / ₹770.33 taxable line). Reversing the gross
      // over-claws — it can leave a fully-returned order at a NET LOSS for the
      // franchise and drive a settlement's payable negative (then floored to
      // ₹0). We mirror the counter-return path in franchise-orders.service:
      // proportion = returnedGross / subOrderGross, then reverse that share of
      // the ORIGINAL franchiseEarning so a full return nets the franchise to ₹0.
      // Falls back to the gross only when no original ONLINE_ORDER ledger row
      // exists (return landed before the commission was recorded — rare; the
      // facade logs a warning and still books a standalone reversal).
      let franchiseReversalEarning = totalRefundAmount;
      if (originalLedger) {
        const fullFranchiseEarning = new Prisma.Decimal(
          (originalLedger.franchiseEarning as any) ?? 0,
        );
        const subOrderItems = await this.prisma.orderItem.findMany({
          where: { subOrderId: subOrder.id },
          select: { unitPrice: true, quantity: true },
        });
        const subOrderGross = subOrderItems.reduce(
          (acc, i) => acc.plus(new Prisma.Decimal(i.unitPrice).mul(i.quantity)),
          new Prisma.Decimal(0),
        );
        const proportion = subOrderGross.gt(0)
          ? Prisma.Decimal.min(
              new Prisma.Decimal(1),
              new Prisma.Decimal(totalRefundAmount).div(subOrderGross),
            )
          : new Prisma.Decimal(1);
        franchiseReversalEarning = fullFranchiseEarning
          .mul(proportion)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();
      }

      // Franchise: create reversal ledger entry
      if (franchiseReversalEarning > 0) {
        try {
          await this.franchiseFacade.recordReturnReversal({
            franchiseId: subOrder.franchiseId,
            subOrderId: subOrder.id,
            reversalAmount: franchiseReversalEarning,
          });
          this.logger.log(
            `Franchise commission reversed: ₹${franchiseReversalEarning} (franchise-earning share; gross customer refund ₹${totalRefundAmount}) for return ${returnRecord.returnNumber}`,
          );
        } catch (err) {
          this.logger.error(
            `Failed to reverse franchise commission: ${(err as Error).message}`,
          );
          throw err;
        }
      } else {
        this.logger.log(
          `Franchise reversal computed as ₹0 for return ${returnRecord.returnNumber} (gross refund ₹${totalRefundAmount}) — nothing to reverse`,
        );
      }
    } else {
      // Seller: update CommissionRecord.refundedAdminEarning proportionally per item
      for (const item of returnRecord.items) {
        const orderItem = item.orderItem;
        if (!orderItem) continue;
        const approvedQty = item.qcQuantityApproved || 0;
        if (approvedQty === 0) continue;
        const valueFraction = this.valueFractionOf(item);

        const commissionRecord = await db.commissionRecord.findUnique({
          where: { orderItemId: orderItem.id },
          include: { sellerSettlement: { select: { paidAt: true } } },
        });
        if (!commissionRecord) {
          this.logger.warn(
            `No commission record found for order item ${orderItem.id}`,
          );
          continue;
        }

        // Late-reversal guard: if this commission record is already bundled
        // into a paid settlement past the configured window, reject the
        // reversal so the ledger stays consistent with disbursed payouts.
        this.assertWithinReversalWindow(
          commissionRecord.sellerSettlement?.paidAt ?? null,
          `Return ${returnRecord.returnNumber} for seller order item ${orderItem.id}`,
        );

        // Calculate proportional refund: platformMargin × (approvedQty / totalQty).
        // Conservation invariant: ∑(refundedMargin) across every reversal for
        // this CommissionRecord must equal platformMargin exactly once the
        // cumulative approved qty reaches totalQty, regardless of how many
        // partial returns led there. To hold this across rounding, the final
        // reversal computes `platformMargin − alreadyRefundedMargin` as its
        // refund (the "tail") rather than another proportional slice.
        const totalQty = orderItem.quantity;
        if (totalQty <= 0) continue;

        const priorReversals = await db.commissionReversalRecord.findMany({
          where: { commissionRecordId: commissionRecord.id },
          select: { reversedQty: true },
        });
        const priorApprovedQty = priorReversals.reduce(
          (sum, r) => sum + r.reversedQty,
          0,
        );
        const cumulativeApprovedQty = priorApprovedQty + approvedQty;
        // A partial-VALUE refund (fraction < 1) never fully refunds the
        // commission even when the whole quantity is "returned" — the seller
        // keeps the margin on the un-refunded value. Only treat as fully
        // refunded when the quantity is exhausted AND the value is whole.
        const isFullyRefunded =
          cumulativeApprovedQty >= totalQty && valueFraction >= 1;

        const platformMarginDec = new Prisma.Decimal(
          commissionRecord.platformMargin,
        );
        const alreadyRefundedDec = new Prisma.Decimal(
          commissionRecord.refundedAdminEarning,
        );
        const refundedMarginDec = isFullyRefunded
          ? platformMarginDec
              .sub(alreadyRefundedDec)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          : platformMarginDec
              .mul(approvedQty)
              .div(totalQty)
              .mul(valueFraction)
              .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const refundedMargin = refundedMarginDec.toNumber();

        await db.commissionRecord.update({
          where: { id: commissionRecord.id },
          data: {
            refundedAdminEarning: { increment: refundedMarginDec },
            // Settle the parent status based on what just happened:
            //   · Fully refunded  → REFUNDED (final, no more payout)
            //   · Partial refund  → PENDING (seller still earns on the
            //     unreturned portion; unfreeze from ON_HOLD if needed)
            //   · Nothing new     → keep whatever status it already had
            status: isFullyRefunded
              ? CommissionRecordStatus.REFUNDED
              : commissionRecord.status === CommissionRecordStatus.ON_HOLD
                ? CommissionRecordStatus.PENDING
                : commissionRecord.status,
          },
        });

        // Audit row: one per reversal event so the history survives even if
        // the commission record itself is later adjusted. The parent record's
        // `refundedAdminEarning` is a running sum of these rows.
        //
        // `totalRefundAmount` here records the CUSTOMER refund for this item
        // for the reversal timeline/history (reporting only — no payout or
        // margin math reads it). Prefer the net, discount-aware per-item refund
        // threaded in by the QC step (`netRefundAmount`: snapshot proration /
        // order net-factor + partial-VALUE fraction) so the audit row mirrors
        // what the customer actually got back (matching Return.refundAmount).
        // Fall back to the gross qty × unitPrice × fraction for callers that
        // don't supply a net (e.g. legacy/direct invocations).
        const threadedNet = (item as any)?.netRefundAmount;
        const itemRefund =
          typeof threadedNet === 'number' && Number.isFinite(threadedNet) && threadedNet >= 0
            ? new Prisma.Decimal(threadedNet)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                .toNumber()
            : new Prisma.Decimal(orderItem.unitPrice)
                .mul(approvedQty)
                .mul(valueFraction)
                .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                .toNumber();
        await db.commissionReversalRecord.create({
          data: {
            commissionRecordId: commissionRecord.id,
            source: opts?.source ?? CommissionReversalSource.RETURN_QC,
            returnId: returnRecord.id ?? null,
            returnNumber: returnRecord.returnNumber ?? null,
            reversedQty: approvedQty,
            totalRefundAmount: itemRefund,
            refundedAdminEarning: refundedMargin,
            actorType: opts?.actorType ?? 'SYSTEM',
            actorId: opts?.actorId ?? null,
            note:
              opts?.note ??
              (valueFraction < 1
                ? `Partial-value refund (${Math.round(valueFraction * 100)}% of qty ${approvedQty}/${totalQty})`
                : approvedQty === totalQty
                  ? 'Full return — commission marked REFUNDED'
                  : `Partial return (${approvedQty}/${totalQty})`),
          },
        });

        this.logger.log(
          `Seller commission reversed: ₹${refundedMargin.toFixed(2)} for commission record ${commissionRecord.id} (approvedQty=${approvedQty}/${totalQty})`,
        );
      }
    }

    return totalRefundAmount;
  }
}
