import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
      totalRefund = totalRefund.add(
        new Prisma.Decimal(orderItem.unitPrice).mul(approvedQty),
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

      // Franchise: create reversal ledger entry
      try {
        await this.franchiseFacade.recordReturnReversal({
          franchiseId: subOrder.franchiseId,
          subOrderId: subOrder.id,
          reversalAmount: totalRefundAmount,
        });
        this.logger.log(
          `Franchise commission reversed: ₹${totalRefundAmount} for return ${returnRecord.returnNumber}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to reverse franchise commission: ${(err as Error).message}`,
        );
        throw err;
      }
    } else {
      // Seller: update CommissionRecord.refundedAdminEarning proportionally per item
      for (const item of returnRecord.items) {
        const orderItem = item.orderItem;
        if (!orderItem) continue;
        const approvedQty = item.qcQuantityApproved || 0;
        if (approvedQty === 0) continue;

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
        const isFullyRefunded = cumulativeApprovedQty >= totalQty;

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
              ? 'REFUNDED'
              : commissionRecord.status === 'ON_HOLD'
                ? 'PENDING'
                : commissionRecord.status,
          },
        });

        // Audit row: one per reversal event so the history survives even if
        // the commission record itself is later adjusted. The parent record's
        // `refundedAdminEarning` is a running sum of these rows.
        const itemRefund = new Prisma.Decimal(orderItem.unitPrice)
          .mul(approvedQty)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber();
        await db.commissionReversalRecord.create({
          data: {
            commissionRecordId: commissionRecord.id,
            source: 'RETURN_QC',
            returnId: returnRecord.id ?? null,
            returnNumber: returnRecord.returnNumber ?? null,
            reversedQty: approvedQty,
            totalRefundAmount: itemRefund,
            refundedAdminEarning: refundedMargin,
            actorType: 'SYSTEM',
            actorId: null,
            note:
              approvedQty === totalQty
                ? 'Full return — commission marked REFUNDED'
                : `Partial return (${approvedQty}/${totalQty})`,
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
