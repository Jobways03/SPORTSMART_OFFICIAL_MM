import { Injectable, Logger } from '@nestjs/common';
import type { RefundMethod } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

export interface RefundSplitLeg {
  method: RefundMethod;
  /** Paise this leg covers. Always positive. */
  amountInPaise: bigint;
  /** Audit-trail reason (surfaced on the RefundInstruction). */
  reason: string;
  /**
   * Suffix appended to the parent idempotency key so the legs can be
   * persisted as separate RefundInstruction rows without colliding on
   * the unique `idempotencyKey` constraint.
   */
  legSuffix: string;
}

export interface CalculateSplitInput {
  masterOrderId: string | null;
  totalRefundAmountInPaise: bigint;
  /**
   * When set, overrides the method auto-detection for the SINGLE-source
   * (no-split) case. Multi-source orders always split regardless — the
   * customer cannot refund wallet money to a card.
   */
  customerPreferredMethod?: RefundMethod;
  /**
   * Phase 258 — when true, the ENTIRE refund is routed to the wallet as a
   * single leg, regardless of how the order was originally paid (gateway,
   * wallet, or split). Used for cancels/rejections that happen BEFORE seller
   * acceptance: the paid amount is returned as instant store credit instead of
   * reversing to the card. Distinct from customerPreferredMethod (which only
   * steers the single-source case and is ignored for the gateway leg of a
   * genuine split).
   */
  forceFullWallet?: boolean;
}

/**
 * Multi-payment refund split.
 *
 * Background: an order can be paid by a combination of wallet credit
 * and Razorpay gateway. Example — basket total ₹2500, customer applies
 * ₹500 wallet, pays ₹2000 via card. The wallet contribution is recorded
 * as a WalletTransaction `(type=DEBIT, referenceType=ORDER,
 * referenceId=<masterOrderId>)`; the card portion is the order's
 * `totalAmountInPaise`. Pre-2026-05-16 the refund path collapsed this
 * back into a single RefundInstruction and routed the whole amount to
 * one method — money ended up in the wrong place, and the customer's
 * statements didn't reconcile.
 *
 * This service:
 *   1. Sums up WalletTransaction DEBITs against the order to detect a
 *      wallet contribution.
 *   2. Splits the refund proportionally — `wallet_portion =
 *      total_refund × wallet_paid / order_total`, with the gateway
 *      portion derived by subtraction so no paise leaks.
 *   3. Returns one leg per source.
 *
 * Pure read-only — the persistence of RefundInstruction rows happens
 * in RefundInstructionService. Idempotency of the split itself is
 * handled by the parent service's `idempotencyKey + legSuffix`.
 */
@Injectable()
export class RefundSplitCalculatorService {
  private readonly logger = new Logger(RefundSplitCalculatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateSplit(input: CalculateSplitInput): Promise<RefundSplitLeg[]> {
    const { masterOrderId, totalRefundAmountInPaise, customerPreferredMethod } =
      input;

    if (totalRefundAmountInPaise <= 0n) {
      return [];
    }

    // Phase 258 — pre-acceptance cancels/rejections return the full paid
    // amount to the wallet as instant store credit (one leg), bypassing the
    // gateway-vs-wallet split entirely. The caller decides when this applies
    // (order/sub-order not yet seller-accepted).
    if (input.forceFullWallet) {
      return [
        {
          method: 'WALLET',
          amountInPaise: totalRefundAmountInPaise,
          reason: 'Refunded to wallet (cancelled before seller acceptance)',
          legSuffix: 'wallet',
        },
      ];
    }

    // Goodwill / no-order refunds — single leg to wallet (or customer
    // preference if it survives validation).
    if (!masterOrderId) {
      return [
        {
          method: customerPreferredMethod ?? 'WALLET',
          amountInPaise: totalRefundAmountInPaise,
          reason: 'No source order — refund credited to wallet',
          legSuffix: 'wallet',
        },
      ];
    }

    const order = await this.prisma.masterOrder.findUnique({
      where: { id: masterOrderId },
      select: {
        id: true,
        totalAmountInPaise: true,
        paymentMethod: true,
        // Phase 184 (#12) — authoritative wallet-usage snapshot.
        walletAmountUsedInPaise: true,
      },
    });
    if (!order) {
      this.logger.warn(
        `calculateSplit: order ${masterOrderId} not found; defaulting to single wallet leg`,
      );
      return [
        {
          method: 'WALLET',
          amountInPaise: totalRefundAmountInPaise,
          reason: 'Source order not found — wallet fallback',
          legSuffix: 'wallet',
        },
      ];
    }

    // Phase 184 (#12) — PREFER the authoritative snapshot on the order. This
    // removes the COD / fully-wallet-paid ambiguity AND sidesteps a latent
    // referenceType case-mismatch ('ORDER' vs the legacy 'order') + the new
    // ORDER_REDEMPTION type. Fall back to the ledger scan only for legacy orders
    // that predate the snapshot column (walletAmountUsedInPaise still 0).
    let walletPaidInPaise: bigint = order.walletAmountUsedInPaise ?? 0n;
    if (walletPaidInPaise <= 0n) {
      const walletDebits = await this.prisma.walletTransaction.findMany({
        where: {
          referenceType: { in: ['ORDER', 'order'] },
          referenceId: masterOrderId,
          type: { in: ['DEBIT', 'DEBIT_ADJUSTMENT', 'ORDER_REDEMPTION'] },
          status: 'COMPLETED',
        },
        select: { amountInPaise: true },
      });
      walletPaidInPaise = walletDebits.reduce(
        (sum, tx) => sum + bigintAbs(tx.amountInPaise),
        0n,
      );
    }

    const orderTotalInPaise = order.totalAmountInPaise;
    // Gateway portion = order total - wallet portion. Capped at zero
    // defensively (a wallet that overpaid the order is a separate bug).
    const gatewayPaidInPaise =
      orderTotalInPaise > walletPaidInPaise
        ? orderTotalInPaise - walletPaidInPaise
        : 0n;

    // Branch 1: wallet-only order — single leg to wallet.
    if (gatewayPaidInPaise === 0n && walletPaidInPaise > 0n) {
      return [
        {
          method: 'WALLET',
          amountInPaise: totalRefundAmountInPaise,
          reason: `Order was fully paid from wallet (₹${(walletPaidInPaise / 100n).toString()})`,
          legSuffix: 'wallet',
        },
      ];
    }

    // Branch 2: gateway-only order (the common case) — single leg.
    if (walletPaidInPaise === 0n) {
      const method = methodForGatewayLeg(order.paymentMethod);
      return [
        {
          method: customerPreferredMethod === 'WALLET' ? 'WALLET' : method,
          amountInPaise: totalRefundAmountInPaise,
          reason:
            customerPreferredMethod === 'WALLET'
              ? `Customer preferred wallet (gateway refund possible but customer chose wallet)`
              : `Order paid via ${order.paymentMethod}; reversing to source`,
          legSuffix:
            customerPreferredMethod === 'WALLET' ? 'wallet' : 'gateway',
        },
      ];
    }

    // Branch 3: split — proportional refund per leg.
    //
    // Gateway leg is computed by SUBTRACTION rather than re-multiplied
    // independently. This guarantees `wallet_leg + gateway_leg ===
    // totalRefundAmountInPaise` exactly, even when the proportional
    // multiplication rounds down. The single-paise rounding remainder
    // always lands in the gateway leg.
    const walletLegInPaise =
      (totalRefundAmountInPaise * walletPaidInPaise) / orderTotalInPaise;
    const gatewayLegInPaise = totalRefundAmountInPaise - walletLegInPaise;

    const legs: RefundSplitLeg[] = [];
    if (walletLegInPaise > 0n) {
      legs.push({
        method: 'WALLET',
        amountInPaise: walletLegInPaise,
        reason:
          `Wallet portion: original order had ₹${(walletPaidInPaise / 100n).toString()} wallet ` +
          `+ ₹${(gatewayPaidInPaise / 100n).toString()} gateway. Proportional split applied.`,
        legSuffix: 'wallet',
      });
    }
    if (gatewayLegInPaise > 0n) {
      legs.push({
        method: methodForGatewayLeg(order.paymentMethod),
        amountInPaise: gatewayLegInPaise,
        reason:
          `Gateway portion: reversing to ${order.paymentMethod} per original payment.`,
        legSuffix: 'gateway',
      });
    }

    if (legs.length === 0) {
      // Defensive: totalRefundAmountInPaise was 0 (we short-circuited
      // above) or every leg rounded to zero (shouldn't happen with
      // BigInt integer division but document the case).
      this.logger.warn(
        `calculateSplit produced no legs for order ${masterOrderId} (refund=${totalRefundAmountInPaise} wallet=${walletPaidInPaise} gateway=${gatewayPaidInPaise})`,
      );
    }

    return legs;
  }
}

function bigintAbs(v: bigint): bigint {
  return v < 0n ? -v : v;
}

function methodForGatewayLeg(orderPaymentMethod: string): RefundMethod {
  // COD orders reverse via UPI / MANUAL since there's no gateway leg.
  // Online / prepaid orders go through ORIGINAL_PAYMENT (Razorpay refund).
  const upper = orderPaymentMethod.toUpperCase();
  if (upper === 'COD') return 'UPI';
  return 'ORIGINAL_PAYMENT';
}
