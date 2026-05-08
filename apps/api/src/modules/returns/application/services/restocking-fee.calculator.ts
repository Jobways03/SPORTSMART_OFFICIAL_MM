import { Injectable } from '@nestjs/common';
import { EnvService } from '../../../../bootstrap/env/env.service';

/**
 * Phase 5 (PR 5.4) — restocking fee calculator.
 *
 * Deducted from a refund when the return is the buyer's fault — they
 * changed their mind, ordered the wrong size, etc. — and the merchant
 * still has to inspect, repackage, and re-list the item.
 *
 * Inputs the calculator considers:
 *   - The return-item's `reasonCategory`. A genuinely defective product
 *     (DEFECTIVE / DAMAGED_IN_TRANSIT / WRONG_ITEM / NOT_AS_DESCRIBED)
 *     never carries a restocking fee — the merchant is at fault.
 *   - The QC outcome. A REJECTED outcome means we keep the merchandise
 *     anyway and there's no refund to deduct from.
 *   - The configured fee rate from RETURN_RESTOCKING_FEE_BPS. 0 = off.
 *
 * Returned shape pairs the gross refund with the deducted fee so the
 * caller can:
 *   - record both numbers on the RefundInstruction, and
 *   - tell the customer in the rejection-reason text exactly how
 *     much was withheld and why.
 *
 * Rounding: fees are computed in paise and floored. We never round UP
 * a fee against the customer; over-collecting violates "fair forfeit"
 * and would make the customer-trust copy in the FAQ unenforceable.
 */

export type RestockingReason =
  | 'DEFECTIVE'
  | 'WRONG_ITEM'
  | 'NOT_AS_DESCRIBED'
  | 'DAMAGED_IN_TRANSIT'
  | 'CHANGED_MIND'
  | 'SIZE_FIT_ISSUE'
  | 'QUALITY_ISSUE'
  | 'OTHER';

export interface FeeInput {
  grossRefundInPaise: number;
  reason: RestockingReason | string;
}

export interface FeeOutput {
  grossRefundInPaise: number;
  feeInPaise: number;
  netRefundInPaise: number;
  feeBps: number;
  feeApplied: boolean;
  reason: string;
}

/**
 * Reasons for which we DO charge the customer a restocking fee. Anything
 * not in this set keeps the full refund.
 */
const BUYER_FAULT_REASONS = new Set<string>([
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'QUALITY_ISSUE', // subjective — customer-side complaint, fee applies
  'OTHER',
]);

@Injectable()
export class RestockingFeeCalculator {
  constructor(private readonly env: EnvService) {}

  feeBps(): number {
    return this.env.getNumber('RETURN_RESTOCKING_FEE_BPS', 0);
  }

  isBuyerFault(reason: string): boolean {
    return BUYER_FAULT_REASONS.has(reason);
  }

  compute(input: FeeInput): FeeOutput {
    const bps = this.feeBps();
    const applies = bps > 0 && this.isBuyerFault(input.reason);
    if (!applies) {
      return {
        grossRefundInPaise: input.grossRefundInPaise,
        feeInPaise: 0,
        netRefundInPaise: input.grossRefundInPaise,
        feeBps: bps,
        feeApplied: false,
        reason: input.reason,
      };
    }
    // bps / 10_000 = fraction. Floor (we never over-charge) and clamp
    // to grossRefund so a 10001-bps misconfig (which Zod rejects, but
    // belt-and-braces) can't drive the net negative.
    const fee = Math.min(
      input.grossRefundInPaise,
      Math.floor((input.grossRefundInPaise * bps) / 10_000),
    );
    return {
      grossRefundInPaise: input.grossRefundInPaise,
      feeInPaise: fee,
      netRefundInPaise: input.grossRefundInPaise - fee,
      feeBps: bps,
      feeApplied: fee > 0,
      reason: input.reason,
    };
  }
}
