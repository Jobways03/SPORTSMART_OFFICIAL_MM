import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const QC_OUTCOMES = ['APPROVED', 'REJECTED', 'PARTIAL', 'DAMAGED'] as const;

// Phase 13 — liability attribution + remedy required at QC time so
// the ledger (SellerDebit / LogisticsClaim / PlatformExpense) can be
// written without a separate admin step. Reuses the dispute enums
// (ADR-016) so the matrix stays consistent across modules.
const LIABILITY_PARTIES = [
  'NONE',
  'SELLER',
  'LOGISTICS',
  'PLATFORM',
  'CUSTOMER',
  // Phase 13 completion — non-core attributions.
  'FRANCHISE',
  'BRAND',
  'INCONCLUSIVE',
] as const;

const REFUND_METHODS = [
  'WALLET',
  'ORIGINAL_PAYMENT',
  'BANK_TRANSFER',
  'UPI',
  'COUPON',
  'MANUAL',
] as const;
const CUSTOMER_REMEDIES = [
  'FULL_REFUND',
  'PARTIAL_REFUND',
  'NO_REFUND',
  'GOODWILL_CREDIT',
  // Phase 13 (P1.14) — return-only remedies that ship a replacement
  // SKU instead of crediting the wallet.
  'REPLACEMENT',
  'EXCHANGE',
] as const;

export class QcDecisionItemDto {
  @IsNotEmpty()
  @IsUUID()
  returnItemId!: string;

  @IsNotEmpty()
  @IsIn(QC_OUTCOMES as unknown as string[])
  qcOutcome!: 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  qcQuantityApproved!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  qcNotes?: string;

  /**
   * Partial-VALUE refund override (gross, tax-inclusive paise). Only
   * honoured when qcOutcome === 'PARTIAL'. When set, this item refunds
   * this amount instead of `qcQuantityApproved × unitPrice`, and the GST
   * reversal + seller commission reversal scale proportionally
   * (fraction = this ÷ full line refund, clamped to [0,1]). Omit for
   * full-quantity approvals.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  qcRefundAmountInPaise?: number;
}

export class QcLogisticsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  awbNumber?: string;
}

export class SubmitQcDecisionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => QcDecisionItemDto)
  decisions!: QcDecisionItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  overallNotes?: string;

  /**
   * Required when at least one item is APPROVED / PARTIAL. The service
   * enforces this conditionally so a pure-rejection path stays simple.
   */
  @IsOptional()
  @IsIn(LIABILITY_PARTIES as unknown as string[])
  liabilityParty?:
    | 'NONE'
    | 'SELLER'
    | 'LOGISTICS'
    | 'PLATFORM'
    | 'CUSTOMER'
    | 'FRANCHISE'
    | 'BRAND'
    | 'INCONCLUSIVE';

  /**
   * Required when at least one item is APPROVED / PARTIAL.
   *  - FULL_REFUND     → all items approved
   *  - PARTIAL_REFUND  → some items approved
   *  - NO_REFUND       → all items rejected (only valid combo)
   *  - GOODWILL_CREDIT → finance treats as PlatformExpense
   */
  @IsOptional()
  @IsIn(CUSTOMER_REMEDIES as unknown as string[])
  customerRemedy?:
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'NO_REFUND'
    | 'GOODWILL_CREDIT'
    | 'REPLACEMENT'
    | 'EXCHANGE';

  /** Public-facing rationale shown to the customer. ≥15 chars. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  qcRationale?: string;

  /** Admin-only triage notes; never surfaced to customer. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNotes?: string;

  /** Courier metadata, only relevant when liabilityParty=LOGISTICS. */
  @IsOptional()
  @ValidateNested()
  @Type(() => QcLogisticsDto)
  logistics?: QcLogisticsDto;

  /**
   * Phase 13 (P1.8) — admin override for the seller-response window.
   * When liabilityParty=SELLER and the seller's response is still
   * PENDING, the service refuses by default so the seller's voice is
   * preserved. Set this to true to deliberately bypass (e.g. seller
   * is non-responsive across multiple cases, urgent customer-facing
   * decision needed). Audit-logged either way.
   */
  @IsOptional()
  @IsBoolean()
  overrideSellerResponseWindow?: boolean;

  /**
   * Phase 13 (P1.11 follow-up) — acknowledge that this return scored
   * HIGH on the risk model. Required when issuing a cash refund on a
   * return whose `riskScore ≥ 60`. Audit-logged so risky-refund
   * approvals are traceable.
   */
  @IsOptional()
  @IsBoolean()
  acknowledgeHighRisk?: boolean;

  /**
   * Phase 13 (P1.14) — target variant for an EXCHANGE remedy. The
   * customer is swapping their original SKU for this one. The service
   * REQUIRES this when customerRemedy=EXCHANGE; ignored otherwise.
   * For REPLACEMENT (same SKU), the original variantId is reused
   * automatically.
   */
  @IsOptional()
  @IsUUID()
  exchangeTargetVariantId?: string;

  /**
   * Phase 13 completion — admin override for the refund method that
   * the auto-initiated refund uses. Defaults to WALLET (current
   * Sportsmart policy). Only honoured when the QC decision actually
   * triggers a refund (cash-refund remedies on QC_APPROVED /
   * PARTIALLY_APPROVED). REPLACEMENT / EXCHANGE remedies don't
   * involve a customer-side refund so this is ignored there.
   */
  @IsOptional()
  @IsIn(REFUND_METHODS as unknown as string[])
  refundMethod?:
    | 'WALLET'
    | 'ORIGINAL_PAYMENT'
    | 'BANK_TRANSFER'
    | 'UPI'
    | 'COUPON'
    | 'MANUAL';

  /**
   * Phase 13 completion — admin override for the refund amount (in
   * paise). When omitted, the service computes it from
   * `qcQuantityApproved × unitPrice`. Use sparingly — overrides
   * land in the audit log so finance can verify the numbers.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountInPaise?: number;

  /**
   * Phase 13 completion — flag the QC outcome as needing a SECOND
   * admin's confirmation before it's binding. Distinct from
   * `acknowledgeHighRisk` (which is the current admin acknowledging
   * the risk score before proceeding). When `requiresApproval=true`,
   * the return enters a "queued for approval" state and a second
   * admin must explicitly confirm via a follow-up endpoint. For
   * Phase 13 we accept the flag and stamp it on the audit row;
   * the dual-admin enforcement workflow ships in a follow-up.
   */
  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}
