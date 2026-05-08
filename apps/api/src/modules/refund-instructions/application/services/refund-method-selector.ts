import { Injectable, Logger } from '@nestjs/common';
import type { RefundMethod, RefundSourceType } from '@prisma/client';

export interface RefundMethodInput {
  /** What's driving this refund. Influences default method choice. */
  source: RefundSourceType;
  /** Original order's payment method (e.g. 'COD', 'ONLINE'). May be null for goodwill. */
  originalPaymentMethod?: string | null;
  /** Customer's explicit preference (set on return wizard / dispute reply). */
  customerPreference?: RefundMethod;
  /** True when the refund is the price-difference settle-up of a replacement. */
  isReplacement?: boolean;
  /** True when the customer has accepted a goodwill coupon. */
  isGoodwillCoupon?: boolean;
  /** True when COD-bank-details (UPI ID or bank acc) are missing for the customer. */
  codBankDetailsMissing?: boolean;
}

export interface RefundMethodDecision {
  method: RefundMethod;
  /** Reason the method was selected — useful for ops audit. */
  reason: string;
  /**
   * True when the chosen method requires manual completion (admin
   * confirms after wiring the money externally). Drives whether the
   * RefundInstruction should land in MANUAL_REQUIRED.
   */
  requiresManualConfirmation: boolean;
}

/**
 * Phase 3 (PR 3.6) — Refund method auto-selection.
 *
 * Maps the brief's rules into a single deterministic function that
 * picks the right RefundMethod for an in-flight refund.
 *
 * Rules (per ADR-009):
 *   - Customer preference, when allowed, wins.
 *   - Goodwill (no order tie-in) → wallet or coupon.
 *   - Replacement at zero net-cost → no refund needed (caller skips).
 *   - Prepaid (ONLINE) order → original payment by default; wallet on
 *     customer preference.
 *   - COD order with bank details on file → bank/UPI transfer.
 *   - COD order without bank details → MANUAL — ops to collect details.
 *
 * Idempotent + side-effect-free. Tests pin the rule table below.
 */
@Injectable()
export class RefundMethodSelector {
  private readonly logger = new Logger(RefundMethodSelector.name);

  select(input: RefundMethodInput): RefundMethodDecision {
    // Goodwill coupon path (admin-driven; doesn't traverse normal rules).
    if (input.isGoodwillCoupon) {
      return {
        method: 'COUPON',
        reason: 'Goodwill coupon issued; no funds movement required',
        requiresManualConfirmation: false,
      };
    }

    // Customer-preference short-circuit. We honour preferences that
    // are within the allowed set for the given order type. (E.g. a
    // customer cannot demand BANK_TRANSFER on a prepaid order — the
    // refund must go back to the original card per RBI / Razorpay
    // chargeback rules. Only WALLET is a valid downgrade.)
    if (input.customerPreference === 'WALLET') {
      return {
        method: 'WALLET',
        reason: 'Customer preference: wallet credit',
        requiresManualConfirmation: false,
      };
    }

    // Goodwill / manual / no-order — wallet by default.
    if (input.source === 'GOODWILL' || !input.originalPaymentMethod) {
      return {
        method: 'WALLET',
        reason: 'No original payment to reverse; crediting wallet',
        requiresManualConfirmation: false,
      };
    }

    const original = input.originalPaymentMethod.toUpperCase();

    // COD path.
    if (original === 'COD') {
      if (input.codBankDetailsMissing) {
        return {
          method: 'MANUAL',
          reason:
            'COD refund: customer has not supplied UPI / bank account; ops to follow up',
          requiresManualConfirmation: true,
        };
      }
      // Default to UPI when present (faster than bank transfer); fall
      // back to bank otherwise. Phase 5 will wire this to the affiliate-
      // payouts adapter that already handles UPI/bank choice.
      return {
        method: 'UPI',
        reason: 'COD refund: pushing to customer UPI',
        requiresManualConfirmation: true,
      };
    }

    // Prepaid path — Razorpay refund to original payment.
    if (original === 'ONLINE' || original === 'PREPAID') {
      return {
        method: 'ORIGINAL_PAYMENT',
        reason: 'Prepaid order: refund to original payment',
        requiresManualConfirmation: false,
      };
    }

    // Unknown payment method — surface to ops.
    this.logger.warn(
      `Unknown originalPaymentMethod=${input.originalPaymentMethod} for source=${input.source}; falling back to MANUAL`,
    );
    return {
      method: 'MANUAL',
      reason: `Unknown original payment method ${input.originalPaymentMethod}`,
      requiresManualConfirmation: true,
    };
  }
}
