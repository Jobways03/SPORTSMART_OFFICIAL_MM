import { Inject, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { CommissionRecordStatus } from '@prisma/client';
import { validateImageUpload } from '../../../../core/util/image-magic-bytes';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AppLoggerService } from '../../../../bootstrap/logging/app-logger.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '../../../../core/exceptions';
import { assertTransition } from '../../../../core/fsm/status-transitions';
import { applyOptimisticTransition } from '../../../../core/fsm/optimistic-transition';
import { CaseDuplicateService } from '../../../../core/case-duplicate/case-duplicate.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
// Phase 93 (2026-05-23) — Gap #5/#24 evidence URL allowlist.
import { validateEvidenceUrls } from '../../domain/evidence-url-validator';
import { resolveTrustedMediaHosts } from '../../../../core/util/trusted-media-hosts';
import { RestockingFeeCalculator } from './restocking-fee.calculator';
import { CustomerAbuseCounterService } from './customer-abuse-counter.service';
import { MediaStorageAdapter } from '../../../../integrations/media/media-storage.adapter';
import { FileService } from '../../../files/application/services/file.service';
import {
  RETURN_REPOSITORY,
  ReturnRepository,
} from '../../domain/repositories/return.repository.interface';
import { ReturnAutoApprovalService } from './return-auto-approval.service';
import { ReturnEligibilityService } from './return-eligibility.service';
import { ReturnStockRestorationService } from './return-stock-restoration.service';
import { ReturnCommissionReversalService } from './return-commission-reversal.service';
import { RefundGatewayService } from './refund-gateway.service';
import { CommissionPublicFacade } from '../../../commission/application/facades/commission-public.facade';
import { LiabilityLedgerPublicFacade } from '../../../liability-ledger/application/facades/liability-ledger-public.facade';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import {
  assertReturnDecisionMatrix,
  mapReturnDecisionToLedger,
  ReturnCustomerRemedy,
  ReturnLiabilityParty,
} from './return-decision-matrix';
import {
  classifyReasonForSellerResponse,
  computeSellerResponseDueAt,
} from './seller-response-classifier';
import { ReturnRiskScorerService } from './return-risk-scorer.service';
import type { RiskAssessment } from './return-risk-scorer';
import { ReplacementOrderService } from './replacement-order.service';
import { RazorpayAdapter } from '../../../../integrations/razorpay/adapters/razorpay.adapter';
import { verifyRazorpaySignature } from './razorpay-signature';
import { DiscountAllocationService } from '../../../discounts/application/services/discount-allocation.service';
import { computeOrderDiscountNetFactor } from './discount-net-factor.util';
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';
import {
  CreditNoteService,
  Section34TimeBarredError,
  SourceInvoiceNotFoundError,
} from '../../../tax/application/services/credit-note.service';
import { WalletAdjustmentService } from '../../../tax/application/services/wallet-adjustment.service';
import { isWithinSection34Window } from '../../../tax/domain/credit-note-time-bar';

export interface CreateReturnInput {
  subOrderId: string;
  items: Array<{
    orderItemId: string;
    quantity: number;
    reasonCategory: string;
    reasonDetail?: string;
  }>;
  customerNotes?: string;
  // Fair-forfeit acknowledgment — validated at the DTO layer but we
  // thread it through to the service so the audit trail records that
  // the customer accepted the policy at submission time.
  forfeitConsent: boolean;
  // Photo URLs the customer uploaded to evidence the issue. Optional
  // at the DTO layer; the service applies a reason-based requirement
  // (DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED / DAMAGED_IN_TRANSIT /
  // QUALITY_ISSUE require ≥1; CHANGED_MIND / SIZE_FIT_ISSUE accept 0).
  evidenceFileUrls?: string[];
}

export interface ListCustomerReturnsParams {
  page: number;
  limit: number;
  status?: string;
}

export interface ListAllReturnsParams {
  page: number;
  limit: number;
  status?: string;
  customerId?: string;
  subOrderId?: string;
  fulfillmentNodeType?: string;
  fromDate?: Date;
  toDate?: Date;
  search?: string;
  // Phase 174 (audit #228) — risk-review dashboard server-side filter.
  riskScoreMin?: number;
  riskScoreMax?: number;
  hasRiskScore?: boolean;
  // Phase 38 (admin breadth) — restrict to the admin's seller-type scope.
  allowedSellerTypes?: ('D2C' | 'RETAIL')[];
}

export interface SchedulePickupInput {
  pickupScheduledAt: Date;
  pickupAddress?: any; // optional override; default to shipping address
  pickupTrackingNumber?: string;
  pickupCourier?: string;
}

export interface SubmitQcDecisionInput {
  decisions: Array<{
    returnItemId: string;
    qcOutcome: 'APPROVED' | 'REJECTED' | 'PARTIAL' | 'DAMAGED';
    qcQuantityApproved: number;
    qcNotes?: string;
    /**
     * Partial-VALUE refund override (gross, tax-inclusive paise). Only
     * honoured when qcOutcome === 'PARTIAL'. When set, this item refunds
     * this amount instead of qty × unitPrice, and the GST reversal +
     * seller commission are reversed proportionally. Clamped to the full
     * line refund; omit for full-quantity approvals.
     */
    qcRefundAmountInPaise?: number;
  }>;
  overallNotes?: string;
  // Phase 13 — required when any item is approved/partial. The service
  // validates the matrix (e.g. SELLER+NO_REFUND is invalid) and writes
  // the corresponding ledger row.
  liabilityParty?:
    | 'NONE'
    | 'SELLER'
    | 'LOGISTICS'
    | 'PLATFORM'
    | 'CUSTOMER'
    | 'FRANCHISE'
    | 'BRAND'
    | 'INCONCLUSIVE';
  customerRemedy?:
    | 'FULL_REFUND'
    | 'PARTIAL_REFUND'
    | 'NO_REFUND'
    | 'GOODWILL_CREDIT'
    | 'REPLACEMENT'
    | 'EXCHANGE';
  qcRationale?: string;
  internalNotes?: string;
  logistics?: {
    courierName?: string;
    awbNumber?: string;
  };
  /**
   * Phase 13 (P1.8) — when SELLER liability is being assigned but the
   * seller's response window is still PENDING, the service refuses by
   * default. Pass true to deliberately bypass.
   */
  overrideSellerResponseWindow?: boolean;
  /**
   * Phase 13 (P1.11) — admin must explicitly acknowledge a HIGH risk
   * score before issuing a cash refund. Audit-logged.
   */
  acknowledgeHighRisk?: boolean;
  /**
   * Phase 13 (P1.14) — target variant for EXCHANGE remedy. Required
   * when customerRemedy=EXCHANGE.
   */
  exchangeTargetVariantId?: string;
  /**
   * Phase 13 completion — admin overrides for the refund leg.
   * `refundMethod` lets ops pick BANK_TRANSFER for high-value cases;
   * `amountInPaise` overrides the computed (qty × unitPrice) total
   * (audit-logged). `requiresApproval` flags the case for a second
   * admin's signoff (workflow stamping only in this PR; full
   * dual-admin enforcement ships next).
   */
  refundMethod?:
    | 'WALLET'
    | 'ORIGINAL_PAYMENT'
    | 'BANK_TRANSFER'
    | 'UPI'
    | 'COUPON'
    | 'MANUAL';
  amountInPaise?: number;
  requiresApproval?: boolean;
}

export interface ConfirmRefundInput {
  refundReference: string;
  refundMethod?: string;
  notes?: string;
}

const REFUND_MAX_RETRY_ATTEMPTS = 5;

/**
 * Scale a tax-reversal snapshot by a partial-VALUE fraction (0..1). Used
 * when an admin issues a partial-amount refund on a PARTIAL QC outcome: the
 * GST reversal / credit-note amounts must shrink in lock-step with the
 * customer refund so the ledger reconciles. `gstRateBps` is a rate (not an
 * amount) so it is preserved as-is. All paise fields are BigInt.
 */
function scaleReversalSnapshot(snapshot: any, fraction: number): any {
  if (!snapshot) return snapshot;
  const scale = (v: bigint | number) =>
    BigInt(Math.round(Number(v) * fraction));
  return {
    grossReturnedInPaise: scale(snapshot.grossReturnedInPaise),
    discountReversalInPaise: scale(snapshot.discountReversalInPaise),
    taxableReversalInPaise: scale(snapshot.taxableReversalInPaise),
    cgstReversalInPaise: scale(snapshot.cgstReversalInPaise),
    sgstReversalInPaise: scale(snapshot.sgstReversalInPaise),
    igstReversalInPaise: scale(snapshot.igstReversalInPaise),
    totalTaxReversalInPaise: scale(snapshot.totalTaxReversalInPaise),
    totalCreditNoteInPaise: scale(snapshot.totalCreditNoteInPaise),
    gstRateBps: snapshot.gstRateBps,
  };
}

/**
 * Compose the SellerDebit amount for a SELLER-fault return: the seller's
 * recovered product value (Option A — ₹0 if the seller was never paid) PLUS
 * the reverse-logistics delivery charge. The delivery charge applies EVEN when
 * the product value is ₹0 ("seller never made the sale" — within-window),
 * so a seller-fault return always bills at least the delivery cost their fault
 * caused. Returns an itemised breakdown string appended to the ledger reason.
 */
export function computeSellerReturnDebitPaise(args: {
  productRecoverablePaise: bigint;
  deliveryChargePaise: bigint;
}): { totalPaise: bigint; breakdown: string } {
  const { productRecoverablePaise, deliveryChargePaise } = args;
  const totalPaise = productRecoverablePaise + deliveryChargePaise;
  const parts: string[] = [];
  if (productRecoverablePaise > 0n)
    parts.push(`product ₹${(Number(productRecoverablePaise) / 100).toFixed(2)}`);
  if (deliveryChargePaise > 0n)
    parts.push(
      `reverse-delivery ₹${(Number(deliveryChargePaise) / 100).toFixed(2)}`,
    );
  return { totalPaise, breakdown: parts.length ? ` (${parts.join(' + ')})` : '' };
}

// Phase 106 (2026-05-23) — Phase 102 audit Gap #14 closure.
//
// Map a raw failure reason (which may contain gateway internals like
// "Razorpay error: card declined CVV mismatch", bank-side strings, or
// even raw stack traces) to a customer-friendly message. We err on the
// side of vagueness — the customer cares that we're handling it, not
// the technical detail. Admin UI still gets the raw reason.
function customerSafeRefundFailureMessage(rawReason: string | null | undefined): string {
  if (!rawReason) {
    return 'We hit an issue processing your refund. Our team is on it.';
  }
  const lower = String(rawReason).toLowerCase();
  if (lower.includes('cap') && lower.includes('exhaust')) {
    return 'We were unable to complete your refund automatically after multiple attempts. Our payments team has been notified and will reach out shortly with next steps.';
  }
  if (
    lower.includes('insufficient') ||
    lower.includes('not enough balance')
  ) {
    return 'A temporary issue prevented your refund from completing. We are retrying automatically.';
  }
  if (
    lower.includes('account closed') ||
    lower.includes('invalid account') ||
    lower.includes('account not found')
  ) {
    return 'Your refund couldn’t reach the original account. We’ll route it through an alternate method — please check back in 24 hours or contact support if needed.';
  }
  if (lower.includes('declined') || lower.includes('rejected')) {
    return 'The bank/payment provider declined the refund. Our payments team is investigating and will contact you with next steps.';
  }
  if (lower.includes('manual') || lower.includes('admin')) {
    return 'Your refund needs manual processing. Our team will complete it within 1-2 business days.';
  }
  // Default — vague but reassuring.
  return 'We hit an issue processing your refund. Our payments team is on it and will retry shortly.';
}

// Phase 106 (2026-05-23) — Phase 102 audit Gap #14 closure.
//
// Project a return row down to a customer-safe shape: redact admin-
// only fields (raw failure reason, internal notes, audit pointers)
// while keeping the customer-facing equivalents.
function projectReturnForCustomer<T extends Record<string, any>>(ret: T): T {
  if (!ret || typeof ret !== 'object') return ret;
  const {
    refundFailureReason: _rawReason,
    qcInternalNotes: _internalQc,
    qcRationale: _rationale,
    refundFailedBy: _failedBy,
    refundFailedByActor: _failedByActor,
    refundFailedAt: _failedAt,
    closedBy: _closedBy,
    closedByActorType: _closedByActor,
    refundFailureHistory: _history,
    sellerResponseNotes: _sellerNotes,
    sellerContestReasonCategory: _contestCat,
    riskScore: _risk,
    riskFlags: _riskFlags,
    riskScoredAt: _riskAt,
    ...safeRest
  } = ret as any;
  return safeRest as T;
}

// Phase 106 (2026-05-23) — Phase 101 audit Gap #28 closure.
//
// Append one entry to the refundFailureHistory ring (bounded to 10).
// Existing history is parsed defensively — JSONB columns can be any
// shape if hand-edited / migrated.
function appendFailureHistory(
  existing: unknown,
  entry: {
    attemptNumber: number;
    reason: string;
    actorType?: string;
    actorId?: string;
  },
): Array<Record<string, unknown>> {
  const arr = Array.isArray(existing) ? [...(existing as any[])] : [];
  arr.push({
    attemptNumber: entry.attemptNumber,
    reason: entry.reason,
    occurredAt: new Date().toISOString(),
    actorType: entry.actorType ?? null,
    actorId: entry.actorId ?? null,
  });
  // Keep the most recent 10 entries.
  return arr.slice(-10);
}

// Phase 94 (2026-05-23) — Seller/Franchise Return Response audit
// Gap #13. Seller-supplied notes get a defence-in-depth scrub before
// the column write: strip HTML tags + control chars, collapse
// whitespace, hard cap at 2000 chars. The DTO already enforces 2000
// chars at the validator boundary, but we double-check here so direct
// service callers (admin tools, batched imports, future internal flows)
// don't bypass the cap. Returns null for empty/whitespace input so the
// column stays NULL rather than an empty string.
function sanitizeRespondNotes(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = String(raw)
    // Drop angle-bracket tags entirely (defense-in-depth even though
    // safeHtml escapes downstream — we don't want hostile script tag
    // payloads sitting in the DB column forever).
    .replace(/<[^>]*>/g, '')
    // Strip ASCII control chars (sans \n, \r, \t).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Collapse runs of whitespace.
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, 2000);
}

@Injectable()
export class ReturnService {
  constructor(
    @Inject(RETURN_REPOSITORY)
    private readonly returnRepo: ReturnRepository,
    private readonly prisma: PrismaService,
    private readonly eligibilityService: ReturnEligibilityService,
    private readonly autoApprovalService: ReturnAutoApprovalService,
    private readonly stockRestorationService: ReturnStockRestorationService,
    private readonly commissionReversalService: ReturnCommissionReversalService,
    private readonly refundGateway: RefundGatewayService,
    private readonly media: MediaStorageAdapter,
    private readonly eventBus: EventBusService,
    private readonly caseDuplicates: CaseDuplicateService,
    private readonly env: EnvService,
    private readonly restockingFee: RestockingFeeCalculator,
    private readonly abuseCounter: CustomerAbuseCounterService,
    private readonly commissionFacade: CommissionPublicFacade,
    private readonly logger: AppLoggerService,
    // Phase 13 — liability ledger writes (SellerDebit / LogisticsClaim
    // / PlatformExpense) are issued straight from QC submission so
    // returns share the money-flow story disputes already use.
    private readonly liabilityLedger: LiabilityLedgerPublicFacade,
    // Audit trail for return / refund actions (compliance + ops debug).
    private readonly audit: AuditPublicFacade,
    // Phase 13 (P1.11) — risk scorer; computes a 0-100 score at intake
    // time so high-risk returns route to manual review.
    private readonly riskScorer: ReturnRiskScorerService,
    // Phase 13 (P1.14) — replacement / exchange order creation. Called
    // best-effort after a QC decision picks REPLACEMENT or EXCHANGE.
    private readonly replacementOrders: ReplacementOrderService,
    private readonly razorpayAdapter: RazorpayAdapter,
    // Phase C (P0.2) — discount-aware refund proration. Returns null
    // for legacy orders without per-item tax snapshots; caller falls
    // back to the existing gross-price refund logic in that case.
    private readonly discountAllocation: DiscountAllocationService,
    // Phase 7 (PR 7.3) — paise-sibling dual-write for refundAmount /
    // amount columns on the return / returnItem / refundTransaction
    // models. No-ops when MONEY_DUAL_WRITE_ENABLED=false (dev/CI).
    private readonly moneyDualWrite: MoneyDualWriteHelper,
    // GST Phase 11 — Section 34 credit note issued on QC approval,
    // linking the original tax invoice's CGST/SGST/IGST reversal to
    // the QC-approved quantities. Idempotent on the return: multi-cycle
    // QC (partial → fuller approval over days) yields per-line deltas.
    private readonly creditNote: CreditNoteService,
    // GST Phase 13 — wallet-adjustment fallback when Section 34 blocks
    // a credit note (original invoice older than 30 Sept of FY+1). The
    // platform absorbs the GST cost and the refund posts via the
    // wallet ledger under dual-approval gating.
    private readonly walletAdjustment: WalletAdjustmentService,
    // Additive central FileMetadata registration for QC-evidence assets
    // uploaded straight to media. @Optional so the existing
    // positional-construction unit specs (which stop at walletAdjustment)
    // keep working; production wiring injects it via the @Global
    // FilesModule. Usage is best-effort and optional-chained.
    @Optional()
    private readonly fileService?: FileService,
  ) {
    this.logger.setContext('ReturnService');
  }

  /**
   * Best-effort: trigger immediate commission lock for the sub-order
   * after a terminal-rejected return transition. Wrapped in try/catch
   * so a downstream failure (e.g. the commission processor's repo
   * blowing up) doesn't poison the return-rejection write that already
   * succeeded — the cron is the safety net that will pick this up on
   * the next tick if we silently skipped here.
   */
  private async triggerImmediateCommission(
    subOrderId: string,
    reason: string,
  ): Promise<void> {
    try {
      await this.commissionFacade.lockCommissionForSubOrderImmediately(
        subOrderId,
        reason,
      );
    } catch (err) {
      this.logger.warn(
        `Immediate commission lock failed for sub-order ${subOrderId}; cron will retry. Error: ${(err as Error)?.message}`,
      );
    }
  }

  // ── Phase-5 helpers ───────────────────────────────────────────────────

  private getQcMinEvidence(): number {
    // Phase 0 (Gap audit) — env-schema default is now 2; the second
    // argument here is the fallback if EnvService cannot resolve the
    // key at all (which should never happen in a healthy boot). Keep
    // it at 2 so the runtime fallback matches the schema default.
    return this.env.getNumber('RETURN_QC_MIN_EVIDENCE', 2);
  }

  // ── Eligibility ────────────────────────────────────────────────────────

  async getOrderEligibility(
    masterOrderId: string,
    customerId: string,
    auditContext?: { ipAddress?: string | null; userAgent?: string | null },
  ) {
    return this.eligibilityService.checkOrderEligibility(
      masterOrderId,
      customerId,
      auditContext,
    );
  }

  // ── Create ─────────────────────────────────────────────────────────────

  async createReturn(customerId: string, input: CreateReturnInput) {
    // Validate
    const { subOrder, masterOrder } =
      await this.eligibilityService.validateReturnRequest({
        customerId,
        subOrderId: input.subOrderId,
        items: input.items.map((i) => ({
          orderItemId: i.orderItemId,
          quantity: i.quantity,
        })),
      });

    // Phase 5 (PR 5.3) — R1: one active return per orderItem. Check
    // BEFORE generateNextReturnNumber so a rejected duplicate doesn't
    // burn a return-number sequence value. Iterates per item so the
    // duplicate row identifies the offending item to the user.
    for (const item of input.items) {
      await this.caseDuplicates.assertNoActiveReturnForOrderItem({
        orderItemId: item.orderItemId,
        actor: { type: 'CUSTOMER', id: customerId },
      });
    }

    // Generate return number
    const returnNumber = await this.returnRepo.generateNextReturnNumber();

    // Enforce the fair-forfeit consent gate. DTO already validates this
    // but we double-check here so any internal caller can't skip it.
    if (!input.forfeitConsent) {
      throw new BadRequestAppException(
        'Customer must accept the forfeit policy before a return can be created.',
      );
    }

    // Phase 13 — reason-based evidence requirement.
    // Damaged / defective / wrong-item / not-as-described / quality_issue
    // claims must be photo-evidenced (the QC team relies on the customer's
    // intake shots and a "claim with no photos" is a known abuse vector).
    // Size-fit and changed-mind reasons don't need photos: the customer's
    // word is enough since there's nothing to prove visually.
    const evidenceRequiredReasons = new Set([
      'DEFECTIVE',
      'WRONG_ITEM',
      'NOT_AS_DESCRIBED',
      'DAMAGED_IN_TRANSIT',
      'QUALITY_ISSUE',
    ]);
    const evidenceOptionalReasons = new Set(['SIZE_FIT_ISSUE', 'OTHER']);
    const evidenceNotRequiredReasons = new Set(['CHANGED_MIND']);
    const requiresEvidence = input.items.some((it) =>
      evidenceRequiredReasons.has(it.reasonCategory),
    );
    const allOptionalOrSkippable = input.items.every(
      (it) =>
        evidenceOptionalReasons.has(it.reasonCategory) ||
        evidenceNotRequiredReasons.has(it.reasonCategory),
    );
    const hasEvidence =
      input.evidenceFileUrls && input.evidenceFileUrls.length > 0;
    if (requiresEvidence && !hasEvidence) {
      throw new BadRequestAppException(
        'At least one photo is required for damaged / defective / wrong-item ' +
          '/ not-as-described / quality issue claims. Upload a clear photo of ' +
          'the issue before submitting.',
      );
    }
    // Allow no evidence on a fully size/changed-mind return; otherwise we
    // still preserve the prior behaviour of requiring at least one shot
    // (covers the OTHER reason and any mixed cart that included one of
    // those reasons).
    if (!hasEvidence && !allOptionalOrSkippable && !requiresEvidence) {
      throw new BadRequestAppException(
        'At least one photo of the issue is required to submit a return.',
      );
    }

    // Phase 93 (2026-05-23) — Gap #5/#24 evidence URL allowlist.
    // Format-validates each URL + checks the host against the
    // media allowlist (env-tunable in production). Rejects
    // localhost/metadata/non-https URLs to close the SSRF/phishing
    // vector.
    if (input.evidenceFileUrls && input.evidenceFileUrls.length > 0) {
      const allowedHosts = resolveTrustedMediaHosts(
        this.env?.getOptional?.('R2_PUBLIC_BASE_URL' as any),
        this.env?.getOptional?.('RETURN_EVIDENCE_ALLOWED_HOSTS' as any),
      );
      const bad = validateEvidenceUrls(input.evidenceFileUrls, {
        allowedHosts,
      });
      if (bad) {
        throw new BadRequestAppException(
          `Evidence URL #${bad.index + 1} rejected: ${bad.reason}`,
        );
      }
    }

    // Phase 93 — Gap #2/#8 compute seller-response state + node
    // snapshot upfront so they land inside the create tx.
    const sellerResponseRequirement = classifyReasonForSellerResponse(
      input.items.map((i) => i.reasonCategory),
    );
    const subOrderAny = subOrder as any;
    const nodeType: 'SELLER' | 'FRANCHISE' | null = subOrderAny.franchiseId
      ? 'FRANCHISE'
      : subOrderAny.sellerId
        ? 'SELLER'
        : null;
    // Both seller- and franchise-fulfilled sub-orders get a response window
    // when the reason requires one — the fulfillment node (seller OR franchise)
    // is the physical receiver and gets a fair chance to accept/contest before
    // QC. The franchise respond/rescind endpoints mirror the seller ones, and
    // the same sweeper expires an unanswered PENDING after the window. (Earlier
    // the franchise path was forced to NOT_REQUIRED because no franchise respond
    // endpoint existed; that endpoint now exists, so the gate applies to both.)
    const sellerResponseStatus: 'PENDING' | 'NOT_REQUIRED' =
      sellerResponseRequirement === 'REQUIRED' ? 'PENDING' : 'NOT_REQUIRED';
    const sellerNotifiedAt =
      sellerResponseStatus === 'PENDING' ? new Date() : undefined;
    const sellerResponseDueAt = sellerNotifiedAt
      ? computeSellerResponseDueAt(sellerNotifiedAt)
      : undefined;

    // Create return — Phase 93 routes evidence + seller-response +
    // node snapshot through the repo so everything commits atomically.
    const created = await this.returnRepo.create({
      returnNumber,
      subOrderId: subOrder.id,
      masterOrderId: masterOrder.id,
      customerId,
      initiatedBy: 'CUSTOMER',
      initiatorId: customerId,
      customerNotes: input.customerNotes,
      items: input.items.map((i) => ({
        orderItemId: i.orderItemId,
        quantity: i.quantity,
        reasonCategory: i.reasonCategory,
        reasonDetail: i.reasonDetail,
      })),
      evidenceFileUrls: input.evidenceFileUrls ?? [],
      sellerResponseStatus,
      sellerNotifiedAt,
      sellerResponseDueAt,
      sellerIdSnapshot: nodeType === 'SELLER' ? subOrderAny.sellerId : null,
      franchiseIdSnapshot:
        nodeType === 'FRANCHISE' ? subOrderAny.franchiseId : null,
      nodeTypeSnapshot: nodeType,
      // Phase 95 (2026-05-23) — Phase 93 deferred #26 closure.
      // Commission freeze threads through into the repo's tx so the
      // PENDING→ON_HOLD flip commits atomically with the Return row.
      // Pre-Phase-95 this fired as a sequential post-create call and
      // a crash between the two left commission unfrozen against a
      // real return — the next settlement cycle would have paid out.
      commissionFreezeReason: `Held pending return ${returnNumber}`,
    });

    // Phase 93 (2026-05-23) — Gap #1/#2/#4 closure.
    //
    // Pre-Phase-93 evidence + seller-response state + an additional
    // status-history row were written here as separate post-tx
    // statements. A crash between the create-tx commit and any of
    // these statements left a phantom return missing evidence /
    // seller-response. The repo's create transaction now persists
    // everything atomically; the duplicate post-tx writes were
    // removed.

    // Phase 95 — commission freeze count surfaced from the repo so
    // we keep the audit + log surface the standalone helper provided.
    const commissionFrozenCount: number =
      (created as any).__commissionFrozenCount ?? 0;
    if (commissionFrozenCount > 0) {
      this.logger.log(
        `Commission frozen for sub-order ${subOrder.id}: ${commissionFrozenCount} record(s) PENDING → ON_HOLD (Held pending return ${returnNumber})`,
      );
      this.audit
        .writeAuditLog({
          actorRole: 'SYSTEM',
          action: 'commission.frozen',
          module: 'returns',
          resource: 'sub_order',
          resourceId: subOrder.id,
          newValue: {
            count: commissionFrozenCount,
            reason: `Held pending return ${returnNumber}`,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `[commission.frozen] audit write failed for sub-order ${subOrder.id}: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        });
    }

    // Publish requested event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.requested',
        aggregate: 'Return',
        aggregateId: created.id,
        occurredAt: new Date(),
        payload: {
          returnId: created.id,
          returnNumber,
          customerId,
          subOrderId: subOrder.id,
          masterOrderId: masterOrder.id,
          itemCount: input.items.length,
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail. Phase 93 (2026-05-23) — Gap #13:
    // surface the failure as a WARN log so silent audit gaps are
    // observable. Don't re-throw — audit must not block return
    // creation, but the loss should be obvious in dashboards.
    this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'return.created',
        module: 'returns',
        resource: 'return',
        resourceId: created.id,
        newValue: {
          returnNumber,
          subOrderId: subOrder.id,
          masterOrderId: masterOrder.id,
          itemCount: input.items.length,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `Audit log write failed for return ${returnNumber}: ${(err as Error)?.message ?? err}`,
        );
      });

    this.logger.log(
      `Return ${returnNumber} created by customer ${customerId}`,
    );

    // ── Auto-approval evaluation ────────────────────────────────────────
    const fullReturn = await this.returnRepo.findByIdWithItems(created.id);
    // Phase 5 (PR 5.5) — soft hold for repeat-returners. The cron-driven
    // counter flips a customer-level bit when they cross the threshold;
    // when it's set we route this return to admin review regardless of
    // what the auto-approval rules say. The auto-approval service still
    // runs (its decision goes into the log line) but we don't act on it.
    const flaggedForAbuse = await this.abuseCounter.shouldHoldForManualReview(
      customerId,
    );
    const autoApprovalDecision =
      this.autoApprovalService.evaluateAutoApproval(fullReturn);

    // Phase 13 (P1.11) — risk scoring. Best-effort persists riskScore +
    // riskFlags onto the return. HIGH-risk returns skip auto-approval
    // even if autoApprovalDecision says yes; admin reviews them
    // manually. Risk evaluation runs after auto-approval rules so the
    // log line captures both.
    let riskAssessment: RiskAssessment | null = null;
    try {
      riskAssessment = await this.riskScorer.scoreAndPersist({
        returnId: created.id,
        customerId,
        items: ((fullReturn as any)?.items ?? []).map((it: any) => ({
          unitPrice: Number(it.orderItem?.unitPrice ?? 0),
          quantity: it.quantity,
          reasonCategory: it.reasonCategory,
        })),
        evidenceCount: input.evidenceFileUrls?.length ?? 0,
        // Phase 13 completion — seller + courier aggregates feed the
        // two new dimensions (SELLER_HIGH_WRONG_ITEM_RATE,
        // COURIER_DAMAGE_HOTSPOT). Best-effort: missing values just
        // skip those dimensions in the scorer.
        sellerId: (fullReturn as any)?.subOrder?.sellerId ?? null,
        courierName: (fullReturn as any)?.subOrder?.courierName ?? null,
      });
    } catch {
      // Risk scorer is best-effort. createReturn must not fail because
      // of a scorer outage — the return creation already succeeded.
    }
    const blockedByRisk = riskAssessment?.level === 'HIGH';

    if (
      !flaggedForAbuse &&
      !blockedByRisk &&
      autoApprovalDecision.autoApprove
    ) {
      // Phase 93 (2026-05-23) — Gap #12 optimistic-lock CAS. The
      // just-created row has version=0; using updateWithVersion catches
      // a racing admin-reject that ran between our create and this
      // update. On CAS mismatch (Prisma P2025) the auto-approval
      // silently no-ops — admin's reject wins.
      try {
        await this.returnRepo.updateWithVersion(created.id, 0, {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: 'SYSTEM',
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          this.logger.log(
            `Auto-approval skipped for ${returnNumber}: version drift (likely admin action raced)`,
          );
          return this.returnRepo.findByIdWithItems(created.id);
        }
        throw err;
      }
      await this.returnRepo.recordStatusChange(
        created.id,
        'REQUESTED',
        'APPROVED',
        'SYSTEM',
        undefined,
        `Auto-approved: ${autoApprovalDecision.reason}`,
      );

      try {
        await this.eventBus.publish({
          eventName: 'returns.return.approved',
          aggregate: 'Return',
          aggregateId: created.id,
          occurredAt: new Date(),
          payload: {
            returnId: created.id,
            returnNumber,
            approvedBy: 'SYSTEM',
            autoApproved: true,
          },
        });
      } catch {
        // events are best-effort
      }

      this.logger.log(
        `Return ${returnNumber} auto-approved: ${autoApprovalDecision.reason}`,
      );
    } else {
      const reason = flaggedForAbuse
        ? 'manual review forced (customer abuse counter flagged)'
        : blockedByRisk
        ? `risk score ${riskAssessment?.score} (${riskAssessment?.level}) flags=[${riskAssessment?.flags.join(',')}]`
        : autoApprovalDecision.reason;
      this.logger.log(`Return ${returnNumber} not auto-approved: ${reason}`);
    }

    // Lazy refresh of the abuse counter. Runs after the return is
    // created so this customer's NEXT return sees the latest numbers
    // (including the one we just opened). Errors here are non-fatal —
    // the nightly cron would catch a missed update anyway.
    this.abuseCounter
      .recompute(customerId)
      .catch((err) =>
        this.logger.warn(
          `abuse-counter recompute failed for customer ${customerId}: ${(err as Error).message}`,
        ),
      );

    return this.returnRepo.findByIdWithItems(created.id);
  }

  // ── List customer returns ──────────────────────────────────────────────

  async listCustomerReturns(
    customerId: string,
    params: ListCustomerReturnsParams,
  ) {
    // Phase 199 (2026-06-02) — Returns Flow PII audit #2 / #21.
    // findByCustomerIdSafe is a strict-select whitelist; the prior
    // findByCustomerId used `include`, which (Prisma semantics) returns
    // every Return scalar — riskScore, qcInternalNotes, liabilityParty,
    // the raw refundFailureReason, internal actor ids … all leaked into
    // the customer list. The blacklist projectReturnForCustomer was
    // leaky-by-default (anything not explicitly stripped slipped
    // through). The whitelist closes the entire class of leak and keeps
    // the refund summary (#21) the list renders.
    const { returns, total } = await this.returnRepo.findByCustomerIdSafe(
      customerId,
      params,
    );

    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  // ── Return detail ──────────────────────────────────────────────────────

  async getReturnDetail(returnId: string, customerId: string) {
    // Phase 199 (2026-06-02) — Returns Flow PII audit #1/#3/#4/#20/#23.
    // findByIdForCustomer is the strict-select customer read (no QC
    // internals / risk / liability / internal actor ids / version; only
    // CUSTOMER+ADMIN evidence; refundTransactions without
    // gatewayRefundId). Replaces findByIdWithItems (the admin/QC full
    // read) + the leaky blacklist projection.
    const ret = await this.returnRepo.findByIdForCustomer(returnId);
    if (!ret) {
      throw new NotFoundAppException('Return not found');
    }
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }

    // Phase 199 (#3) — status-history notes can carry internal text the
    // customer must not see ("Auto-approved: risk score 78 …", seller
    // contest internals). Keep notes only for CUSTOMER + ADMIN actors
    // (an admin rejection reason and a customer cancellation note are
    // legitimately customer-facing); blank SYSTEM / SELLER / FRANCHISE
    // notes while preserving the visible timeline (status + timestamp).
    if (Array.isArray(ret.statusHistory)) {
      ret.statusHistory = ret.statusHistory.map((h: any) => ({
        ...h,
        notes:
          h.changedBy === 'CUSTOMER' || h.changedBy === 'ADMIN'
            ? h.notes
            : null,
      }));
    }

    // Phase 199 (#24) — side-load the latest dispute for this return so
    // the UI can surface an "Open dispute" CTA on QC_REJECTED /
    // REJECTED. Dispute.returnId is a bare scalar FK (no Prisma
    // relation, by design) so it can't be selected on the Return.
    // Best-effort: a failure must not block the detail load. Only the
    // id + number + status ship — no internal dispute fields.
    let dispute: { id: string; disputeNumber: string; status: string } | null =
      null;
    try {
      const d = await this.prisma.dispute.findFirst({
        where: { returnId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, disputeNumber: true, status: true },
      });
      if (d) {
        dispute = {
          id: d.id,
          disputeNumber: d.disputeNumber,
          status: d.status as string,
        };
      }
    } catch (err) {
      this.logger.warn(
        `getReturnDetail: dispute lookup failed for return ${returnId}: ${(err as Error).message}`,
      );
    }

    // Phase 38 — side-load the refund-settlement story so the
    // customer-facing return detail can render either:
    //   - "Credit note SM-CN-000042 issued for ₹X" (Section 34 window
    //     open at QC-approve time), OR
    //   - "Refund credited to wallet (₹X)" (Section 34 time-barred,
    //     wallet adjustment route), OR
    //   - "Refund processing" (QC approved but neither artefact exists
    //     yet — the post-commit notifications haven't fired).
    //
    // Both reads are best-effort: a failure here MUST NOT block the
    // return detail load. CreditNoteService scopes prior CNs by
    // `reason contains returnNumber`; we mirror that.
    // Phase 199 (#20) — drop the raw DB ids (creditNote.id /
    // walletCredit.id). They are internal surrogate keys the customer
    // UI never needs (it renders documentNumber); exposing them widens
    // the attack surface for nothing.
    let creditNote: {
      documentNumber: string;
      documentTotalInPaise: string;
      status: string;
      generatedAt: Date | null;
    } | null = null;
    let walletCredit: {
      kind: string;
      status: string;
      amountInPaise: string;
      approvedAt: Date | null;
      reason: string;
    } | null = null;
    try {
      const cn = await this.prisma.taxDocument.findFirst({
        where: {
          documentType: 'CREDIT_NOTE',
          reason: { contains: ret.returnNumber },
          status: { notIn: ['VOIDED_DRAFT'] },
        },
        orderBy: { generatedAt: 'desc' },
        select: {
          documentNumber: true,
          documentTotalInPaise: true,
          status: true,
          generatedAt: true,
        },
      });
      if (cn) {
        creditNote = {
          documentNumber: cn.documentNumber,
          documentTotalInPaise: cn.documentTotalInPaise.toString(),
          status: cn.status,
          generatedAt: cn.generatedAt,
        };
      }
    } catch (err) {
      this.logger.warn(
        `getReturnDetail: CN lookup failed for return ${returnId}: ${(err as Error).message}`,
      );
    }
    try {
      const adj = await this.prisma.walletAdjustment.findFirst({
        where: { returnId },
        orderBy: { createdAt: 'desc' },
        select: {
          kind: true,
          status: true,
          amountInPaise: true,
          approvedAt: true,
          reason: true,
        },
      });
      if (adj) {
        walletCredit = {
          kind: adj.kind,
          status: adj.status,
          amountInPaise: adj.amountInPaise.toString(),
          approvedAt: adj.approvedAt,
          reason: adj.reason,
        };
      }
    } catch (err) {
      this.logger.warn(
        `getReturnDetail: wallet adjustment lookup failed for return ${returnId}: ${(err as Error).message}`,
      );
    }

    // Phase 199 — `ret` already came from the customer-safe strict
    // select (findByIdForCustomer): no blacklist projection needed.
    // creditNote / walletCredit / dispute describe the customer's own
    // case and are customer-safe.
    return {
      ...ret,
      creditNote,
      walletCredit,
      dispute,
    };
  }

  // ── Cancel ─────────────────────────────────────────────────────────────

  async cancelReturn(
    returnId: string,
    customerId: string,
    // Phase 93 (2026-05-23) — Gap #23 optional cancellation reason.
    cancellationReason?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) {
      throw new NotFoundAppException('Return not found');
    }
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    // Customer can pull the return at any pre-movement step. This
    // mirrors the admin-reject window (REQUESTED / APPROVED /
    // PICKUP_SCHEDULED) — once IN_TRANSIT, the courier is committed
    // and the warehouse path takes over. Auto-approval moves a return
    // to APPROVED almost immediately, so without this the customer
    // effectively can never cancel.
    const cancellableStatuses = ['REQUESTED', 'APPROVED', 'PICKUP_SCHEDULED'];
    if (!cancellableStatuses.includes(ret.status)) {
      throw new BadRequestAppException(
        `Return cannot be cancelled from status ${ret.status}. Cancel is only allowed before the courier collects the item (REQUESTED / APPROVED / PICKUP_SCHEDULED).`,
      );
    }
    const fromStatus = ret.status;

    const cancelledAt = new Date();
    // Phase 199 (2026-06-02) — Returns audit #12. Optimistic-lock CAS
    // (same helper approveReturn / rejectReturn use) instead of a bare
    // findById-then-update. Without it, a customer cancel racing an
    // admin reject (or a duplicate cancel from a retry) is last-write-
    // wins; the CAS turns the loser into a 409 ConflictAppException so
    // we never silently stomp a fresh terminal transition.
    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'CANCELLED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          closedAt: cancelledAt,
          // Phase 93 — Gap #23 persist cancellation detail.
          cancelledAt,
          cancelledBy: customerId,
          cancelledByRole: 'CUSTOMER',
          cancellationReason: cancellationReason ?? null,
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      fromStatus,
      'CANCELLED',
      'CUSTOMER',
      customerId,
      cancellationReason
        ? `Cancelled by customer: ${cancellationReason}`
        : 'Cancelled by customer',
    );

    // Customer voluntarily cancelled — seller is entitled to their
    // commission, so lift the ON_HOLD freeze.
    await this.unfreezeCommissionForSubOrder(
      ret.subOrderId,
      `Return ${ret.returnNumber} cancelled by customer`,
    );
    // Also lock commission immediately if it hasn't been processed
    // yet (sub-order still inside the deliveredAt window). Without
    // this, the seller waits the rest of the window for no reason —
    // the customer's case is already final.
    await this.triggerImmediateCommission(
      ret.subOrderId,
      `return-cancelled:${ret.returnNumber}`,
    );

    // Publish event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.cancelled',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          customerId,
          cancelledBy: 'CUSTOMER',
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId: customerId,
        actorRole: 'CUSTOMER',
        action: 'return.cancelled',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: fromStatus },
        newValue: { status: 'CANCELLED' },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} cancelled by customer ${customerId}`,
    );
    return updated;
  }

  // ── Admin: list all returns ────────────────────────────────────────────

  async listAllReturns(params: ListAllReturnsParams) {
    const { returns, total } = await this.returnRepo.findAllPaginated(params);
    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  // ── Admin: get return by id ────────────────────────────────────────────

  async getReturnByIdAdmin(returnId: string) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    // Phase C (P0.2) — attach per-item tax snapshots so the admin QC
    // modal can show the discount-aware refund preview without an
    // extra round-trip. Empty array for legacy orders without
    // allocation; the UI falls back to the gross-price refund display.
    const orderItemIds = (ret.items ?? [])
      .map((it: any) => it.orderItemId)
      .filter(Boolean);
    let taxSnapshots: any[] = [];
    let alreadyReversed: any[] = [];
    if (orderItemIds.length > 0) {
      [taxSnapshots, alreadyReversed] = await Promise.all([
        this.prisma.orderItemTaxSnapshot.findMany({
          where: { orderItemId: { in: orderItemIds } },
        }),
        // Existing reversals for this return (idempotent retries +
        // partial-return history). UI uses these to show the
        // remaining refundable amount per item.
        this.prisma.returnTaxReversalLine.findMany({
          where: { returnId },
        }),
      ]);
    }

    // Phase 109 (2026-05-25) — pre-QC Section 34 eligibility preview so the QC
    // modal can warn the admin BEFORE they submit (the authoritative status is
    // only stamped at QC time / by the timebar cron). Prefer the persisted
    // status when the return is already classified.
    let creditNoteEligibilityPreview: string | null =
      (ret as any).creditNoteEligibilityStatus ?? null;
    if (!creditNoteEligibilityPreview) {
      const sourceInvoice = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId: (ret as any).subOrderId,
          documentType: { in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'] },
        },
        orderBy: { generatedAt: 'desc' },
      });
      creditNoteEligibilityPreview =
        !sourceInvoice || !sourceInvoice.generatedAt
          ? 'NO_INVOICE'
          : isWithinSection34Window(sourceInvoice.generatedAt, new Date())
            ? 'ELIGIBLE'
            : 'TIME_BARRED';
    }

    return {
      ...ret,
      creditNoteEligibilityPreview,
      // Phase C — discount-aware refund preview data.
      refundPreview: {
        taxSnapshots,
        priorReversals: alreadyReversed,
      },
    };
  }

  // ── Admin: approve ─────────────────────────────────────────────────────

  async approveReturn(returnId: string, adminId: string, notes?: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    // FSM check + optimistic-lock CAS in one shot. The transition table
    // (returns/REQUESTED → APPROVED) is the single source of truth.
    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'APPROVED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          approvedAt: new Date(),
          approvedBy: adminId,
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REQUESTED',
      'APPROVED',
      'ADMIN',
      adminId,
      notes,
    );

    // Publish event (best-effort)
    try {
      await this.eventBus.publish({
        eventName: 'returns.return.approved',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          approvedBy: adminId,
          autoApproved: false,
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'return.approved',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: { status: 'APPROVED', autoApproved: false },
        metadata: { returnNumber: ret.returnNumber, notes },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} approved by admin ${adminId}`,
    );
    return updated;
  }

  // ── Admin: reject ──────────────────────────────────────────────────────

  async rejectReturn(returnId: string, adminId: string, reason: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    // Admin can reject any time before the item physically arrives at
    // the warehouse. `REQUESTED` is the classic review step; `APPROVED`
    // covers the case where the auto-approval service let something
    // through and admin wants to overrule. `PICKUP_SCHEDULED` is still
    // reversible — we haven't spent courier money yet at the routing
    // layer (scheduling only creates an intent). Once `IN_TRANSIT` or
    // later, the item is physically moving and we must go through QC.
    const preMovementStatuses = ['REQUESTED', 'APPROVED', 'PICKUP_SCHEDULED'];
    if (!preMovementStatuses.includes(ret.status)) {
      throw new BadRequestAppException(
        `Return cannot be rejected from status ${ret.status}. Reject is only allowed before the item ships (REQUESTED / APPROVED / PICKUP_SCHEDULED). For items already at the warehouse, use the QC flow.`,
      );
    }

    const fromStatus = ret.status;

    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'REJECTED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          rejectedAt: new Date(),
          rejectedBy: adminId,
          rejectionReason: reason,
          closedAt: new Date(),
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      fromStatus,
      'REJECTED',
      'ADMIN',
      adminId,
      reason,
    );

    // Admin-rejected pre-pickup → return was invalid → seller keeps the
    // commission. Lift the ON_HOLD freeze so the record is eligible for
    // the next settlement cycle.
    await this.unfreezeCommissionForSubOrder(
      ret.subOrderId,
      `Return ${ret.returnNumber} rejected by admin — commission reinstated`,
    );
    // Policy (2026-06-08): a rejected return must NOT lock the seller's
    // commission immediately. The commission instead completes the normal
    // return-window timing (deliveredAt + RETURN_WINDOW_DAYS) and is locked
    // by the per-minute cron once that window elapses — the return is now
    // terminal (REJECTED), so the cron's active-return skip no longer
    // applies and it picks the sub-order up at window close. This keeps a
    // rejected-return order on the SAME commission clock as a no-return
    // order instead of paying the seller early.
    // (Commission that was ALREADY locked before the return is still
    // reinstated above via unfreezeCommissionForSubOrder — that money has
    // already cleared its window, so it is not re-deferred here.)

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.rejected',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          reason,
          rejectedBy: adminId,
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'return.rejected',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: fromStatus },
        newValue: { status: 'REJECTED', reason },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} rejected by admin ${adminId}`,
    );
    return updated;
  }

  // ── Admin: schedule pickup ─────────────────────────────────────────────

  async schedulePickup(
    returnId: string,
    adminId: string,
    input: SchedulePickupInput,
  ) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'PICKUP_SCHEDULED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          pickupScheduledAt: input.pickupScheduledAt,
          pickupAddress:
            input.pickupAddress || ret.masterOrder?.shippingAddressSnapshot,
          pickupTrackingNumber: input.pickupTrackingNumber,
          pickupCourier: input.pickupCourier,
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'APPROVED',
      'PICKUP_SCHEDULED',
      'ADMIN',
      adminId,
      `Pickup scheduled for ${input.pickupScheduledAt.toISOString()}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.pickup_scheduled',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          pickupScheduledAt: input.pickupScheduledAt,
          tracking: input.pickupTrackingNumber,
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId: adminId,
        actorRole: 'ADMIN',
        action: 'return.pickup_scheduled',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: {
          status: 'PICKUP_SCHEDULED',
          pickupScheduledAt: input.pickupScheduledAt,
          courier: input.pickupCourier,
          tracking: input.pickupTrackingNumber,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Pickup scheduled for return ${ret.returnNumber} by admin ${adminId}`,
    );
    return updated;
  }

  // ── Mark in transit (customer or admin) ────────────────────────────────

  async markInTransit(
    returnId: string,
    actorType: string,
    actorId: string,
    trackingNumber?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'PICKUP_SCHEDULED' && ret.status !== 'APPROVED') {
      throw new BadRequestAppException(
        `Return must be APPROVED or PICKUP_SCHEDULED to mark in transit (current: ${ret.status})`,
      );
    }

    const updateData: Record<string, unknown> = { status: 'IN_TRANSIT' };
    if (trackingNumber) updateData.pickupTrackingNumber = trackingNumber;

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'IN_TRANSIT',
      actorType,
      actorId,
      'Package handed over for pickup',
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.in_transit',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          trackingNumber,
        },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.in_transit',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: { status: 'IN_TRANSIT', tracking: trackingNumber },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} marked in transit by ${actorType} ${actorId}`,
    );
    return updated;
  }

  // ── Customer marks handed over ─────────────────────────────────────────

  async markHandedOverByCustomer(
    returnId: string,
    customerId: string,
    trackingNumber?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    // Customers can only mark handed-over AFTER admin has scheduled the
    // pickup. Before scheduling there's no courier to hand the package
    // to — the APPROVED → IN_TRANSIT jump is reserved for admin/system.
    if (ret.status !== 'PICKUP_SCHEDULED') {
      throw new BadRequestAppException(
        ret.status === 'APPROVED'
          ? 'Please wait for the pickup to be scheduled before marking the package as handed over.'
          : `Package can only be marked handed over when a pickup is scheduled (current status: ${ret.status}).`,
      );
    }
    return this.markInTransit(returnId, 'CUSTOMER', customerId, trackingNumber);
  }

  // ── Phase R3: Warehouse receipt & QC ────────────────────────────────────

  /**
   * Mark a return as received at the warehouse/fulfillment node.
   * Allowed from IN_TRANSIT (preferred) or directly from PICKUP_SCHEDULED.
   */
  async markReceived(
    returnId: string,
    actorType: string,
    actorId: string,
    notes?: string,
    parcelCondition?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    // Phase 96 (2026-05-23) — Phase 96 audit Gap #6/#7/#8 closure.
    //
    // Pre-Phase-96 a second call on an already-RECEIVED return would
    // pass through applyOptimisticTransition's same-state branch and:
    //   1. clobber the original receivedAt/receivedBy with the second
    //      caller's values,
    //   2. write a duplicate ReturnStatusHistory row (RECEIVED →
    //      RECEIVED),
    //   3. re-publish returns.return.received → possible duplicate
    //      customer email,
    //   4. duplicate audit log row.
    //
    // Early-return preserves the original receipt record + makes the
    // endpoint truly idempotent without requiring the caller's
    // Idempotency-Key header.
    if (ret.status === 'RECEIVED') {
      this.logger.log(
        `Return ${ret.returnNumber} already RECEIVED; idempotent no-op (actor=${actorType}:${actorId})`,
      );
      return ret;
    }

    const sanitizedNotes = sanitizeRespondNotes(notes);
    const sanitizedCondition = parcelCondition
      ? String(parcelCondition).slice(0, 64)
      : null;
    const bypassedInTransit = ret.status === 'PICKUP_SCHEDULED';

    // Phase 96 — Gap #10 closure. Wrap the FSM update + status history
    // + outbox publish in a single $transaction so a crash between
    // them can't desync. The applyOptimisticTransition update inside
    // the tx still does the version CAS.
    const respondedAt = new Date();
    const txOutcome = await this.prisma.$transaction(async (tx) => {
      // Apply version-CAS update inside the tx.
      let updated: any;
      try {
        updated = await tx.return.update({
          where: { id: returnId, version: (ret as any).version } as any,
          data: {
            status: 'RECEIVED' as any,
            receivedAt: respondedAt,
            receivedBy: actorId,
            receivedByActorType: actorType,
            parcelCondition: sanitizedCondition,
            receivedBypassedInTransit: bypassedInTransit,
            // Phase 97 (2026-05-23) — QC audit Gap #20. Surrogate
            // qcStatus surfaced explicitly so QC queue dashboards +
            // claim-lock flow have a stable column to filter on.
            qcStatus: 'PENDING_QC' as any,
            version: { increment: 1 },
          } as any,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestAppException(
            'Return was modified by another process; please refresh and retry.',
          );
        }
        throw err;
      }
      // FSM defence-in-depth: assertTransition uses the same matrix
      // applyOptimisticTransition would have applied (PICKUP_SCHEDULED
      // | IN_TRANSIT → RECEIVED). If a future schema change widens the
      // allowed source states this guard catches it before we ship.
      try {
        assertTransition(
          'ReturnStatus' as any,
          ret.status,
          'RECEIVED' as any,
        );
      } catch (err) {
        throw err;
      }

      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: ret.status as any,
          toStatus: 'RECEIVED' as any,
          changedBy: actorType,
          changedById: actorId,
          notes: sanitizedNotes,
        },
      });

      await this.eventBus.publish(
        {
          eventName: 'returns.return.received',
          aggregate: 'Return',
          aggregateId: returnId,
          occurredAt: respondedAt,
          payload: {
            returnId,
            returnNumber: ret.returnNumber,
            receivedBy: actorId,
            receivedByActorType: actorType,
            parcelCondition: sanitizedCondition,
            bypassedInTransit,
          },
        },
        { tx },
      );

      return updated;
    });

    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.received',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: {
          status: 'RECEIVED',
          notes: sanitizedNotes,
          parcelCondition: sanitizedCondition,
          bypassedInTransit,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.received] audit write failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    this.logger.log(
      `Return ${ret.returnNumber} marked RECEIVED by ${actorType} ${actorId} (parcelCondition=${sanitizedCondition ?? 'n/a'}, bypassedInTransit=${bypassedInTransit})`,
    );
    return txOutcome;
  }

  /**
   * Upload a QC evidence image for a return (saved to media).
   */
  async uploadQcEvidence(
    returnId: string,
    actorType: string,
    actorId: string,
    fileBuffer: Buffer,
    fileMimetype: string,
    description?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (!['RECEIVED', 'IN_TRANSIT'].includes(ret.status)) {
      throw new BadRequestAppException(
        `Cannot upload QC evidence in status ${ret.status}`,
      );
    }

    // Phase 97 (2026-05-23) — QC audit Gap #4 closure. Magic-byte sniff
    // the buffer before forwarding to media. Pre-Phase-97 the
    // FileInterceptor accepted any binary up to 5 MB; a hostile client
    // could send Content-Type: image/png with an .exe payload and we
    // would happily upload + persist a fake-evidence row. The hand-
    // rolled sniffer rejects on mismatch.
    const sniff = validateImageUpload(fileBuffer, fileMimetype);
    if (!sniff.ok) {
      throw new BadRequestAppException(
        `Evidence upload rejected: ${sniff.reason}`,
      );
    }

    // Phase 97 — Gap #27 dedup via SHA-256 contentHash. Repeated
    // upload of the same image (e.g. admin double-click after preview)
    // dedups to the existing row instead of leaving two media
    // assets + two DB rows.
    const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
    const existing = await this.prisma.returnEvidence.findFirst({
      where: { returnId, contentHash } as any,
    });
    if (existing) {
      this.logger.log(
        `QC evidence dedup hit for return ${ret.returnNumber} (contentHash=${contentHash.slice(0, 8)}…)`,
      );
      return existing;
    }

    // Upload to media
    const uploadResult = await this.media.upload(fileBuffer, {
      folder: `returns/${returnId}/evidence`,
    });

    let evidence: any;
    try {
      // Phase 97 — Gap #10 orphan-leak fix. media upload happens
      // before the DB write; if the DB row insert fails, we need to
      // clean up the media asset. The .delete call is best-effort
      // — a failure here is logged + caught by the daily orphan-cleanup
      // cron (separate concern).
      evidence = await this.returnRepo.addEvidence({
        returnId,
        uploadedBy: actorType,
        uploaderId: actorId,
        fileType: sniff.detected,
        fileUrl: uploadResult.secureUrl,
        publicId: uploadResult.publicId,
        description,
        contentHash,
        width: (uploadResult as any).width,
        height: (uploadResult as any).height,
        bytes: (uploadResult as any).bytes ?? fileBuffer.length,
      } as any);
    } catch (err) {
      this.logger.warn(
        `[uploadQcEvidence] DB row insert failed for return ${ret.returnNumber}; rolling back media asset ${uploadResult.publicId}: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
      try {
        if (typeof (this.media as any).delete === 'function') {
          await (this.media as any).delete(uploadResult.publicId);
        }
      } catch (deleteErr) {
        this.logger.error(
          `[uploadQcEvidence] media rollback delete also failed for ${uploadResult.publicId} (orphan asset): ${
            (deleteErr as Error)?.message ?? 'unknown error'
          }`,
        );
      }
      throw err;
    }

    // Additive, best-effort: register a central FileMetadata row so
    // integrity/audit/orphan-sweep see this evidence asset. Never affects
    // the upload/validation/dedup/persistence flow above. Optional-chained
    // because fileService is @Optional (unit specs omit it).
    void this.fileService
      ?.registerExternalAsset({
        publicId: uploadResult.publicId,
        url: uploadResult.secureUrl,
        mimeType: fileMimetype,
        sizeBytes: (uploadResult as any).bytes ?? fileBuffer.length,
        purpose: 'QC_EVIDENCE',
        uploadedBy: actorId,
        uploadedByType: actorType,
        buffer: fileBuffer,
      })
      .catch(() => undefined);

    this.logger.log(
      `QC evidence uploaded for return ${ret.returnNumber} by ${actorType} ${actorId}`,
    );
    return evidence;
  }

  /**
   * Submit per-item QC decisions. Updates each return item, triggers stock
   * restoration and commission reversal, and moves the return to the
   * appropriate terminal QC state.
   */
  async submitQcDecision(
    returnId: string,
    actorType: string,
    actorId: string,
    input: SubmitQcDecisionInput,
  ) {
    // QC outcome is reserved for marketplace admins. Sellers / franchises /
    // affiliates can upload evidence, mark-received, etc., but the binding
    // refund-driving decision belongs to a neutral arbiter on the marketplace
    // side. Defence-in-depth in addition to the route-level enforcement (the
    // seller / franchise controllers no longer expose the qc-decision route).
    if (actorType !== 'ADMIN') {
      throw new ForbiddenAppException(
        'QC decisions are admin-only. Sellers and fulfillment nodes contribute evidence; the marketplace admin issues the binding outcome.',
      );
    }

    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'RECEIVED') {
      throw new BadRequestAppException(
        `Return must be RECEIVED to submit QC (current: ${ret.status})`,
      );
    }

    // Phase 5 (PR 5.4) — minimum-evidence gate. The flag defaults to 0
    // (off) until QC tooling reliably uploads multiple angles for every
    // inspection. Counting all evidence rows on the return — both the
    // customer-supplied issue photos AND any admin/QC uploads — is
    // intentional: any of them can document the decision later.
    const minEvidence = this.getQcMinEvidence();
    if (minEvidence > 0) {
      const evidenceCount = await this.prisma.returnEvidence.count({
        where: { returnId },
      });
      if (evidenceCount < minEvidence) {
        throw new BadRequestAppException(
          `QC submission requires at least ${minEvidence} evidence file(s); only ${evidenceCount} attached. Upload more photos before submitting the decision.`,
        );
      }
    }

    // Validate decisions match return items
    for (const decision of input.decisions) {
      const item = ret.items.find((i: any) => i.id === decision.returnItemId);
      if (!item) {
        throw new BadRequestAppException(
          `Return item ${decision.returnItemId} not found`,
        );
      }
      if (decision.qcQuantityApproved > item.quantity) {
        throw new BadRequestAppException(
          `qcQuantityApproved (${decision.qcQuantityApproved}) cannot exceed return quantity (${item.quantity})`,
        );
      }
      if (decision.qcQuantityApproved < 0) {
        throw new BadRequestAppException(
          `qcQuantityApproved cannot be negative`,
        );
      }
      // Phase 97 (2026-05-23) — QC audit Gap #18 closure. APPROVED
      // outcome MUST match the full returned qty; if the admin
      // approved less, the outcome should be PARTIAL. Pre-Phase-97 a
      // mismatched APPROVED was silently treated as partial (no error
      // surfaced + audit reflected the wrong outcome).
      if (
        decision.qcOutcome === 'APPROVED' &&
        decision.qcQuantityApproved !== item.quantity
      ) {
        throw new BadRequestAppException(
          `APPROVED outcome requires qcQuantityApproved === return quantity (got ${decision.qcQuantityApproved} of ${item.quantity}). Use PARTIAL outcome to approve only some units.`,
        );
      }
      // Phase 97 — Gap #17 closure. PARTIAL with qty=0 evaluated to
      // noneApproved=true → ended up REJECTED, but with the
      // "partial" outcome on the item row. Confusing input → reject
      // it explicitly.
      if (
        decision.qcOutcome === 'PARTIAL' &&
        decision.qcQuantityApproved <= 0
      ) {
        throw new BadRequestAppException(
          `PARTIAL outcome requires qcQuantityApproved > 0. Use REJECTED to approve zero units.`,
        );
      }
      // Phase 97 — Gap #19 closure. PARTIAL with qty<total still
      // rejects some units, so the customer deserves a per-item
      // explanation. Mirrors the REJECTED/DAMAGED rule.
      const isPartialReject =
        decision.qcOutcome === 'PARTIAL' &&
        decision.qcQuantityApproved < item.quantity;
      // REJECTED / DAMAGED forfeit the customer's item + refund, so the
      // reason must be documented. Accept the reason from EITHER the
      // per-item note OR the overall notes — admins write wherever their
      // UI puts focus and we shouldn't be pedantic about which field as
      // long as *something* explains the decision to the customer.
      if (
        decision.qcOutcome === 'REJECTED' ||
        decision.qcOutcome === 'DAMAGED' ||
        isPartialReject
      ) {
        const perItemOk = (decision.qcNotes ?? '').trim().length >= 15;
        const overallOk = (input.overallNotes ?? '').trim().length >= 15;
        if (!perItemOk && !overallOk) {
          throw new BadRequestAppException(
            `A ${decision.qcOutcome.toLowerCase()} decision (${
              isPartialReject ? 'partial reject' : decision.qcOutcome
            }) requires a reason (min 15 characters) explaining what was found during inspection. Write it in the per-item Notes field or the Overall Notes field.`,
          );
        }
      }
    }

    // Phase C (P0.2) — Pre-compute per-item refund amounts using
    // the discount allocation snapshot. For each return item we ask
    // the allocation service whether a per-line tax snapshot exists:
    //
    //   - Snapshot exists → net refund = (gross − allocated discount)
    //                                    × approvedQty / purchasedQty
    //                                    + proportional GST reversal
    //   - Snapshot absent → legacy gross-price refund (preserves
    //                       existing behavior for orders placed
    //                       before allocation went live)
    //
    // The reversalSnapshot (when present) is held alongside each
    // refund so the QC commit transaction can write a
    // `return_tax_reversal_lines` row for the credit note.
    //
    // Order-level discount net-factor (P0.2 fallback). When NO per-item
    // discount-allocation snapshot exists (DISCOUNT_ALLOCATION_ENABLED off, the
    // default — so this covers every order placed via the legacy checkout path),
    // computeRefundForReturnedItem returns null and we fall back to the GROSS
    // line price (qty × unitPrice). That over-refunds any order that used a
    // coupon: SM20260000026 paid ₹818.10 (₹909 − ₹90.90 AMOUNT_OFF_ORDER) but
    // was refunded the full ₹909. We reconstruct the proportional discount from
    // the master-order totals and scale the gross refund by it so the customer
    // gets back exactly what they paid.
    //
    //   preDiscountSubtotal = total + discount − shipping   (sum of item gross)
    //   netFactor           = (total − shipping) / preDiscountSubtotal
    //                       = (subtotal − discount) / subtotal
    //
    // Shipping is excluded from both sides so a non-zero shipping fee can't
    // dilute the ratio. AMOUNT_OFF_ORDER spreads proportionally across every
    // line, so the order-level factor is the correct per-item factor regardless
    // of multi-item / multi-sub-order splits. With no discount the factor is 1
    // (no behavior change); paise fields fall back to the Decimal siblings for
    // orders placed before the paise backfill. This ONLY scales the gross
    // fallback — when a snapshot exists the discount is already baked into
    // prorated.totalRefundInPaise and must not be applied twice.
    const mo: any = (ret as any).masterOrder ?? null;
    const moTotalPaise =
      Number(mo?.totalAmountInPaise ?? 0) ||
      Math.round(Number(mo?.totalAmount ?? 0) * 100);
    const moDiscountPaise =
      Number(mo?.discountAmountInPaise ?? 0) ||
      Math.round(Number(mo?.discountAmount ?? 0) * 100);
    const moShippingPaise = Number(mo?.shippingFeeInPaise ?? 0);
    const discountNetFactor = computeOrderDiscountNetFactor({
      totalPaise: moTotalPaise,
      discountPaise: moDiscountPaise,
      shippingPaise: moShippingPaise,
    });
    if (discountNetFactor < 1) {
      this.logger.log(
        `[return-refund-discount] return=${returnId} order=${mo?.orderNumber ?? mo?.id} ` +
          `totalPaise=${moTotalPaise} discountPaise=${moDiscountPaise} shippingPaise=${moShippingPaise} ` +
          `netFactor=${discountNetFactor.toFixed(6)} ` +
          `(legacy no-snapshot path: gross refund scaled to net-paid)`,
      );
    }

    const perItemRefunds = await Promise.all(
      input.decisions.map(async (decision) => {
        const item = ret.items.find((i: any) => i.id === decision.returnItemId);
        const unitPrice = Number(item.orderItem?.unitPrice ?? 0);
        const purchasedQuantity = Number(item.orderItem?.quantity ?? 0);
        const orderItemId = item?.orderItem?.id ?? item?.orderItemId;

        // Legacy/safe default: gross calculation.
        const grossRefund =
          Math.round(decision.qcQuantityApproved * unitPrice * 100) / 100;

        // Try discount-aware proration. Only for QC outcomes that
        // refund (APPROVED / PARTIAL); REJECTED and DAMAGED stay 0.
        const wantsRefund =
          (decision.qcOutcome === 'APPROVED' ||
            decision.qcOutcome === 'PARTIAL') &&
          decision.qcQuantityApproved > 0 &&
          purchasedQuantity > 0 &&
          orderItemId;

        let prorated: Awaited<
          ReturnType<DiscountAllocationService['computeRefundForReturnedItem']>
        > = null;
        if (wantsRefund) {
          try {
            prorated = await this.discountAllocation.computeRefundForReturnedItem({
              orderItemId,
              purchasedQuantity,
              approvedQuantity: decision.qcQuantityApproved,
            });
          } catch (e) {
            // Don't fail the QC submission on proration errors;
            // fall back to gross. Audit logs / outbox events will
            // surface this for ops.
            this.logger.warn(
              `Discount proration failed for return item ${decision.returnItemId}; falling back to gross. ${(e as Error).message}`,
            );
            prorated = null;
          }
        }

        // Full (qty-derived) refund for this line before any partial-VALUE
        // override — the discount-aware credit-note total when a snapshot
        // exists, else gross (qty × unitPrice) scaled by the order discount
        // net-factor so a coupon order refunds net-paid, not gross. REJECTED /
        // DAMAGED stay 0.
        const fullRefundPaise =
          prorated !== null
            ? Number(prorated.totalRefundInPaise)
            : decision.qcOutcome === 'REJECTED' ||
                decision.qcOutcome === 'DAMAGED'
              ? 0
              : Math.round(grossRefund * 100 * discountNetFactor);

        // Partial-VALUE refund: the admin chose to give back a specific
        // gross (tax-inclusive) amount for this item instead of the whole
        // line. Only for PARTIAL outcomes with a positive full refund. The
        // fraction (clamped to [0,1]) scales the customer refund, the GST
        // reversal snapshot, AND the seller commission reversal in lock-step
        // so the ledger stays internally consistent.
        let refundValueFraction = 1;
        if (
          decision.qcOutcome === 'PARTIAL' &&
          typeof decision.qcRefundAmountInPaise === 'number' &&
          fullRefundPaise > 0
        ) {
          const overridePaise = Math.min(
            Math.max(0, Math.round(decision.qcRefundAmountInPaise)),
            fullRefundPaise,
          );
          refundValueFraction = overridePaise / fullRefundPaise;
        }

        const refundAmount = (fullRefundPaise * refundValueFraction) / 100;

        return {
          returnItemId: decision.returnItemId,
          qcOutcome: decision.qcOutcome,
          qcQuantityApproved: decision.qcQuantityApproved,
          qcNotes: decision.qcNotes,
          refundAmount,
          // Drives the proportional commission reversal for partial-VALUE
          // refunds (1 = full line; <1 = give back only this share).
          refundValueFraction,
          // Carries through to the QC tx so we can write the
          // ReturnTaxReversalLine row + reverse liability ledger. Scaled to
          // the partial fraction so the GST credit note matches the refund.
          reversalSnapshot:
            prorated?.reversalSnapshot && refundValueFraction < 1
              ? scaleReversalSnapshot(
                  prorated.reversalSnapshot,
                  refundValueFraction,
                )
              : (prorated?.reversalSnapshot ?? null),
          orderItemId: orderItemId ?? null,
        };
      }),
    );

    // Determine overall outcome
    const allApproved = input.decisions.every(
      (d) => d.qcOutcome === 'APPROVED' && d.qcQuantityApproved > 0,
    );
    const noneApproved = input.decisions.every(
      (d) => d.qcQuantityApproved === 0,
    );

    let newStatus: string;
    let qcDecision: string;
    if (noneApproved) {
      newStatus = 'QC_REJECTED';
      qcDecision = 'REJECTED';
    } else if (allApproved) {
      newStatus = 'QC_APPROVED';
      qcDecision = 'APPROVED';
    } else {
      newStatus = 'PARTIALLY_APPROVED';
      qcDecision = 'PARTIAL';
    }

    // Phase 13 — liability + remedy validation. Required whenever any
    // item is approved (full or partial), since we'll write a ledger
    // row in those cases. Pure rejection (QC_REJECTED) doesn't need
    // them — the matrix outcome is "customer fault, no refund".
    const liabilityParty: ReturnLiabilityParty | null =
      (input.liabilityParty ?? null) as ReturnLiabilityParty | null;
    const customerRemedy: ReturnCustomerRemedy | null =
      (input.customerRemedy ?? null) as ReturnCustomerRemedy | null;
    if (newStatus !== 'QC_REJECTED') {
      assertReturnDecisionMatrix({
        newStatus,
        liabilityParty,
        customerRemedy,
      });
    }

    // Phase 13 (P1.14) — EXCHANGE requires the admin to pick a target
    // variant; without it the replacement-order pipeline can't ship
    // anything. Reject upfront so admin sees the message at QC time
    // rather than the order-creation step failing silently afterwards.
    if (customerRemedy === 'EXCHANGE' && !input.exchangeTargetVariantId) {
      throw new BadRequestAppException(
        'EXCHANGE requires `exchangeTargetVariantId` — the SKU to ship the customer instead. ' +
          'Use REPLACEMENT for same-SKU swaps.',
      );
    }

    // Phase 13 (P1.11) — high-risk acknowledgement gate. If the return
    // scored HIGH at intake (risk ≥ 60) and admin is about to issue a
    // cash refund, require an explicit `acknowledgeHighRisk` flag. The
    // gate doesn't apply to REPLACEMENT/EXCHANGE (no money flow),
    // GOODWILL/PARTIAL paths still trigger because money moves either
    // way, and QC_REJECTED naturally bypasses (no refund issued).
    const issuesCashRefund =
      newStatus !== 'QC_REJECTED' &&
      customerRemedy !== 'REPLACEMENT' &&
      customerRemedy !== 'EXCHANGE';
    const HIGH_RISK_THRESHOLD = 60;
    if (
      issuesCashRefund &&
      typeof ret.riskScore === 'number' &&
      ret.riskScore >= HIGH_RISK_THRESHOLD &&
      !input.acknowledgeHighRisk
    ) {
      const flagsArr = Array.isArray(ret.riskFlags)
        ? (ret.riskFlags as string[])
        : [];
      throw new BadRequestAppException(
        `This return scored ${ret.riskScore} (HIGH) at intake — flags: [${flagsArr.join(', ')}]. ` +
          'Re-submit with acknowledgeHighRisk=true to proceed (audit-logged), ' +
          'or pick REPLACEMENT/EXCHANGE if a cash refund isn\'t the right outcome.',
      );
    }

    // Phase 13 (P1.8) — fairness gate. If we're about to attribute
    // liability to the seller but their response window is still open,
    // refuse unless the admin explicitly opts in. This stops the
    // common mistake of a fast-tracked QC stomping on a seller's
    // chance to defend the case.
    if (
      liabilityParty === 'SELLER' &&
      ret.sellerResponseStatus === 'PENDING' &&
      !input.overrideSellerResponseWindow
    ) {
      const dueAt = ret.sellerResponseDueAt;
      const dueAtText = dueAt
        ? ` (window closes ${dueAt.toISOString()})`
        : '';
      throw new BadRequestAppException(
        `Cannot assign SELLER liability while the seller's response is still PENDING${dueAtText}. ` +
          'Wait for the seller to ACCEPT/CONTEST, let the cron expire the window, ' +
          'or pass overrideSellerResponseWindow=true to deliberately bypass (audit-logged).',
      );
    }

    // Phase 95 (2026-05-23) — Phase 94 deferred #21 closure. Admin
    // attributing SELLER liability over a CONTESTED response requires
    // an explicit override-reason note. Pre-Phase-95 the contest was
    // a soft signal — admin could side with the customer without
    // recording why. We now refuse the QC submission unless either
    //   • per-item qcNotes ≥ 30 chars, OR
    //   • input.overallNotes ≥ 30 chars
    // and write a structured audit row labeled 'override_contest'.
    if (
      liabilityParty === 'SELLER' &&
      ret.sellerResponseStatus === 'CONTESTED'
    ) {
      const overallNoteOk = (input.overallNotes ?? '').trim().length >= 30;
      const anyPerItemNoteOk = input.decisions.some(
        (d) => (d.qcNotes ?? '').trim().length >= 30,
      );
      if (!overallNoteOk && !anyPerItemNoteOk) {
        throw new BadRequestAppException(
          'The seller CONTESTED this claim. Attributing SELLER liability requires an override reason (min 30 chars) in overallNotes or any qcNotes — explain why the seller\'s contest evidence does not change the outcome.',
        );
      }
      // Best-effort structured audit so compliance can see "admin
      // overrode contest" patterns per seller.
      this.audit
        .writeAuditLog({
          actorId,
          actorRole: 'ADMIN',
          action: 'return.qc.override_contest',
          module: 'returns',
          resource: 'return',
          resourceId: returnId,
          newValue: {
            sellerResponseStatus: 'CONTESTED',
            attributedLiability: 'SELLER',
            overrideReason: (input.overallNotes ?? '').slice(0, 1000),
          },
          metadata: { returnNumber: ret.returnNumber },
        })
        .catch((err) => {
          this.logger.warn(
            `[return.qc.override_contest] audit write failed for ${ret.returnNumber}: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        });
    }

    // FSM enforcement — RECEIVED is the only valid source state for QC
    // outcomes. The check at the top of this method already validates
    // ret.status === 'RECEIVED' but pinning the rule centrally here means
    // the FSM module is the single source of truth.
    assertTransition('ReturnStatus', ret.status, newStatus);

    const isFranchise = ret.subOrder?.fulfillmentNodeType === 'FRANCHISE';

    // For FRANCHISE returns, stock + commission reversal flow through the
    // franchise facade which manages its own transactions across the module
    // boundary. Run those FIRST so that if they fail we have not yet
    // mutated any return state — admin can retry safely.
    //
    // For SELLER returns, all writes are local Prisma writes and run inside
    // the single transaction below for full atomicity.
    if (isFranchise) {
      // Build a temporary return view with the QC decisions applied so the
      // helper services compute the right amounts.
      const projectedReturn = {
        ...ret,
        items: ret.items.map((it: any) => {
          const decision = perItemRefunds.find(
            (d) => d.returnItemId === it.id,
          );
          return decision
            ? {
                ...it,
                qcQuantityApproved: decision.qcQuantityApproved,
                // Partial-VALUE fraction (1 = full) — commission reversal
                // scales the seller chargeback by this so a partial refund
                // only claws back a proportional slice of the margin.
                refundValueFraction: decision.refundValueFraction ?? 1,
              }
            : it;
        }),
      };
      await this.stockRestorationService.restoreStockForReturn(
        projectedReturn,
        input.decisions,
      );
      await this.commissionReversalService.reverseCommissionForReturn(
        projectedReturn,
      );
    }

    // Single atomic transaction wrapping all return-side writes plus the
    // seller-path stock + commission reversal (no-ops for franchise path).
    const refundAmount = await this.prisma.$transaction(async (tx) => {
      // 1. Update each return item with QC decision
      for (const decision of perItemRefunds) {
        await tx.returnItem.update({
          where: { id: decision.returnItemId },
          data: this.moneyDualWrite.applyPaise('returnItem', {
            qcOutcome: decision.qcOutcome as any,
            qcQuantityApproved: decision.qcQuantityApproved,
            qcNotes: decision.qcNotes,
            // 2-dp decimal-string (not a raw float) so MoneyDualWriteHelper's
            // toPaise accepts it — a partial-VALUE refund can be a non-integer
            // rupee amount (e.g. 3333.50) which it refuses as a bare Number.
            refundAmount: decision.refundAmount.toFixed(2),
          }),
        });

        // Phase C (P0.2) — write tax reversal line + liability
        // ledger reversal whenever discount allocation existed.
        // For legacy orders (no snapshot) reversalSnapshot is null
        // and we skip the writes.
        if (
          decision.reversalSnapshot &&
          decision.orderItemId &&
          decision.qcQuantityApproved > 0
        ) {
          await tx.returnTaxReversalLine.create({
            data: {
              returnId: ret.id,
              returnItemId: decision.returnItemId,
              orderItemId: decision.orderItemId,
              grossReturnedAmountInPaise:
                decision.reversalSnapshot.grossReturnedInPaise,
              discountReversalInPaise:
                decision.reversalSnapshot.discountReversalInPaise,
              taxableReversalInPaise:
                decision.reversalSnapshot.taxableReversalInPaise,
              cgstReversalInPaise:
                decision.reversalSnapshot.cgstReversalInPaise,
              sgstReversalInPaise:
                decision.reversalSnapshot.sgstReversalInPaise,
              igstReversalInPaise:
                decision.reversalSnapshot.igstReversalInPaise,
              totalTaxReversalInPaise:
                decision.reversalSnapshot.totalTaxReversalInPaise,
              totalCreditNoteAmountInPaise:
                decision.reversalSnapshot.totalCreditNoteInPaise,
              gstRateBps: decision.reversalSnapshot.gstRateBps,
            },
          });
        }
      }

      // Phase C (P0.2) — reverse the discount liability ledger
      // entries for each returned item. Runs outside the per-item
      // loop so the ledger calls aren't nested inside the
      // returnItem.update writes — keeps the tx focused.
      for (const decision of perItemRefunds) {
        if (
          decision.reversalSnapshot &&
          decision.orderItemId &&
          decision.qcQuantityApproved > 0
        ) {
          // We can't pass `tx` to the allocation service's reversal
          // helper without a refactor; that service writes through
          // its own client. The reversal is idempotent so a partial
          // tx rollback retries cleanly on the next attempt.
          // (Acceptable trade-off: liability reversal lives outside
          // the QC transaction; QC commit is the source of truth.)
          this.discountAllocation
            .reverseLiabilityForReturnedItem({
              orderItemId: decision.orderItemId,
              proportion: {
                returned: decision.qcQuantityApproved,
                purchased: Number(
                  ret.items.find((i: any) => i.id === decision.returnItemId)
                    ?.orderItem?.quantity ?? 0,
                ),
              },
              reason: 'QC_APPROVED_RETURN',
            })
            .catch((e) =>
              this.logger.warn(
                `Liability ledger reversal failed for orderItem ${decision.orderItemId}: ${(e as Error).message}`,
              ),
            );
        }
      }

      // 2. For seller path: restore stock + reverse commission inside tx.
      //    For franchise path: helpers no-op on the local DB (they only call
      //    the franchise facade which already ran above).
      const projectedReturn = {
        ...ret,
        items: ret.items.map((it: any) => {
          const decision = perItemRefunds.find(
            (d) => d.returnItemId === it.id,
          );
          return decision
            ? {
                ...it,
                qcQuantityApproved: decision.qcQuantityApproved,
                // Partial-VALUE fraction (1 = full) — commission reversal
                // scales the seller chargeback by this so a partial refund
                // only claws back a proportional slice of the margin.
                refundValueFraction: decision.refundValueFraction ?? 1,
              }
            : it;
        }),
      };
      if (!isFranchise) {
        await this.stockRestorationService.restoreStockForReturn(
          projectedReturn,
          input.decisions,
          tx,
        );
      }
      const totalRefund = !isFranchise
        ? await this.commissionReversalService.reverseCommissionForReturn(
            projectedReturn,
            tx,
          )
        : // For franchise path the commission has already been reversed
          // above via the facade — just compute the refund amount locally
          // for the return record.
          this.computeRefundAmount(projectedReturn);

      // 3. Update the return record itself
      await tx.return.update({
        where: { id: returnId },
        data: this.moneyDualWrite.applyPaise('return', {
          status: newStatus as any,
          // Phase 97 (2026-05-23) — QC audit Gap #20 closure. Flip
          // surrogate qcStatus to COMPLETED at decision commit so the
          // QC queue (which filters PENDING_QC) doesn't surface this
          // row anymore.
          // Phase 100 (2026-05-23) — QC audit Gap #13 closure. When
          // input.requiresApproval=true the qcStatus stays
          // AWAITING_SECOND_APPROVAL instead of COMPLETED. Downstream
          // refund auto-initiation is gated on COMPLETED so the
          // first-admin's decision parks until a second admin opens
          // /admin/refunds/:id/approve. The Return.status flip stays
          // (QC_APPROVED / etc.) so QC-side downstream code keeps
          // working; the second-approval gate sits on top.
          qcStatus: input.requiresApproval
            ? 'AWAITING_SECOND_APPROVAL'
            : 'COMPLETED',
          qcCompletedAt: new Date(),
          qcDecision: qcDecision as any,
          qcNotes: input.overallNotes,
          // 2-dp decimal-string — see returnItem note above. A partial-VALUE
          // refund yields a non-integer rupee total that toPaise rejects raw.
          refundAmount: totalRefund.toFixed(2),
          // Phase 13 — persist the liability attribution + remedy used
          // to compute downstream ledger writes. Persisting on the row
          // (not derived from the ledger row alone) gives us a single
          // source of truth for admin UIs and reporting.
          liabilityParty: liabilityParty as any,
          customerRemedy: customerRemedy as any,
          qcRationale: input.qcRationale ?? null,
          qcInternalNotes: input.internalNotes ?? null,
          qcCourierName: input.logistics?.courierName ?? null,
          qcAwbNumber: input.logistics?.awbNumber ?? null,
          // Phase 13 (P1.14) — when admin picks REPLACEMENT or
          // EXCHANGE at QC time, seed the replacement lifecycle so
          // the post-QC flow (stock check, fulfilment, optional
          // payment collection) has a state column to work against.
          // Stays null for refund / goodwill paths so legacy
          // dashboards don't see spurious "PENDING_STOCK_CHECK"
          // statuses on returns that aren't replacement-bound.
          replacementStatus:
            customerRemedy === 'REPLACEMENT' ||
            customerRemedy === 'EXCHANGE'
              ? ('PENDING_STOCK_CHECK' as any)
              : null,
          exchangeTargetVariantId:
            customerRemedy === 'EXCHANGE'
              ? input.exchangeTargetVariantId ?? null
              : null,
        }),
      });

      // 4. Append status history
      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: 'RECEIVED' as any,
          toStatus: newStatus as any,
          changedBy: actorType,
          changedById: actorId,
          notes: input.overallNotes,
        },
      });

      return totalRefund;
    });

    // When QC fully rejects every item, the customer's claim was
    // invalid. Lift the ON_HOLD freeze so the seller earns commission.
    // For APPROVED / PARTIAL paths, the commission-reversal service
    // above has already flipped the relevant records to REFUNDED so
    // ON_HOLD doesn't survive there either.
    if (newStatus === 'QC_REJECTED') {
      await this.unfreezeCommissionForSubOrder(
        ret.subOrderId,
        `Return ${ret.returnNumber} rejected at QC — commission reinstated`,
      );
      // Policy (2026-06-08): a QC-rejected return must NOT lock commission
      // immediately. Like the pre-pickup reject path, the commission
      // completes the normal return-window timing and the cron locks it at
      // window close (the return is terminal, so the active-return skip no
      // longer applies). Same commission clock as a no-return order.
      // (Already-locked commission is reinstated above, not re-deferred.)
    }

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.qc_completed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          qcDecision,
          refundAmount,
          liabilityParty,
          customerRemedy,
        },
      });
    } catch {
      // events are best-effort
    }

    // GST Phase 11/13 — issue the Section 34 credit note for the
    // QC-approved quantities. Synchronous + post-commit so the
    // customer-facing decision (status flip + refund initiation
    // below) is never blocked by a CN failure; the daily
    // TaxCreditNoteTimeBarCron remains the safety net for stuck
    // rows. Three outcomes:
    //
    //   1. Section 34 window open → CreditNoteService persists the
    //      CN + flips the source invoice to PARTIALLY_REVERSED /
    //      FULLY_REVERSED via the FSM.
    //   2. Section 34 window closed → Section34TimeBarredError →
    //      WalletAdjustmentService.requestForTimeBarredReturn records
    //      a TIME_BARRED_CREDIT_NOTE adjustment (PENDING_APPROVAL,
    //      dual-approval if above threshold). Platform absorbs GST.
    //   3. Other CN failure (missing source invoice, snapshot gap,
    //      etc.) → log and rely on the timebar cron + admin
    //      override endpoint to backfill. We do NOT throw — QC has
    //      already advanced and the customer's refund must proceed.
    //
    // Skipped when QC rejected everything (no items to credit).
    //
    // Phase 109 (2026-05-25) — double-refund guard. When the Section 34
    // window has closed the refund is routed via a TIME_BARRED_CREDIT_NOTE
    // wallet adjustment (which IS the customer refund). This flag tells the
    // refund branch below to SKIP the parallel initiateRefund — otherwise the
    // customer is paid twice (once now via gateway/wallet, once when finance
    // approves the adjustment).
    let timebarWalletRouted = false;
    if (newStatus === 'QC_APPROVED' || newStatus === 'PARTIALLY_APPROVED') {
      try {
        const cn = await this.creditNote.generateForReturn(returnId, {
          actorId,
        });
        if (cn.isNew) {
          this.logger.log(
            `Credit note ${cn.creditNote.documentNumber} issued for return ${ret.returnNumber} ` +
              `against invoice ${cn.sourceInvoice.documentNumber} ` +
              `(source now ${cn.sourceInvoice.statusAfter})`,
          );
        } else {
          this.logger.log(
            `Credit note path idempotent: existing ${cn.creditNote.documentNumber} ` +
              `still covers return ${ret.returnNumber}.`,
          );
        }
      } catch (err) {
        // Two "route to wallet instead of credit note" cases:
        //   • TIME_BARRED             — Section 34 window has closed.
        //   • REQUIRES_FINANCE_REVIEW — no source tax invoice to credit
        //     against (legacy / unbilled order; the wallet adjustment's
        //     LEGACY_RECEIPT fallback handles it).
        // Both set the skip flag + stamp eligibility BEFORE attempting the
        // adjustment, so the parallel initiateRefund is suppressed even if the
        // adjustment write fails (the daily cron / admin override retry it) —
        // the customer must never be paid twice. Stamping the column
        // synchronously (vs waiting for the daily cron) also lets
        // initiateRefund's guard + the admin UI see the status immediately.
        const timeBarred = err instanceof Section34TimeBarredError;
        const noSourceInvoice = err instanceof SourceInvoiceNotFoundError;
        if (timeBarred || noSourceInvoice) {
          timebarWalletRouted = true;
          const eligibility = timeBarred
            ? 'TIME_BARRED'
            : 'REQUIRES_FINANCE_REVIEW';
          await this.prisma.return
            .update({
              where: { id: returnId },
              data: {
                creditNoteEligibilityStatus: eligibility,
                creditNoteEligibilityCheckedAt: new Date(),
                creditNoteTimeBarReason: (err as Error).message,
                refundMethod: 'WALLET',
              },
            })
            .catch((updErr) => {
              this.logger.error(
                `Failed to stamp ${eligibility} eligibility on return ${ret.returnNumber}: ${(updErr as Error).message}`,
              );
            });
          // Compliance audit — this return left the normal refund path; the
          // refund is handled via the finance-approved wallet adjustment.
          this.audit
            .writeAuditLog({
              actorId,
              action: 'return.refund.timebar_routed',
              module: 'returns',
              resource: 'return',
              resourceId: returnId,
              metadata: {
                returnNumber: ret.returnNumber,
                eligibility,
                reason: (err as Error).message,
              },
            })
            .catch(() => undefined);
          try {
            const adj = await this.walletAdjustment.requestForTimeBarredReturn({
              returnId,
              requestedByAdminId: actorId,
            });
            this.logger.warn(
              `Return ${ret.returnNumber} routed to wallet adjustment ${adj.id} ` +
                `(status ${adj.status}, eligibility ${eligibility}); no credit ` +
                `note issued.`,
            );
          } catch (adjErr) {
            // Fallback failed — log loudly. TaxCreditNoteTimeBarCron
            // re-classifies daily; admins can also use the time-bar override
            // endpoint to retry.
            this.logger.error(
              `Wallet-adjustment fallback FAILED for return ${ret.returnNumber}: ` +
                `${(adjErr as Error).message} — TaxCreditNoteTimeBarCron will ` +
                `re-classify on next sweep.`,
            );
          }
        } else {
          this.logger.error(
            `Credit-note generation FAILED for return ${ret.returnNumber}: ` +
              `${(err as Error).message} — refund still proceeding; ` +
              `TaxCreditNoteTimeBarCron will re-classify on next sweep.`,
          );
        }
      }
    }

    // Phase 13 — write the liability ledger row that recovers (or
    // expenses) the refund cost. Best-effort: a ledger failure should
    // NOT block the QC decision (the customer-facing decision stands
    // and ops can backfill the ledger row). All writes are idempotent
    // on (sourceType=RETURN, sourceId=returnId) so retries are safe.
    if (
      newStatus !== 'QC_REJECTED' &&
      liabilityParty &&
      liabilityParty !== 'NONE' &&
      liabilityParty !== 'CUSTOMER'
    ) {
      const amountInPaise = Math.round(Number(refundAmount) * 100);
      try {
        await this.recordReturnLiabilityLedger({
          ret,
          returnId,
          liabilityParty,
          customerRemedy,
          amountInPaise,
          rationale: input.qcRationale ?? input.overallNotes ?? '',
          logistics: input.logistics,
        });
      } catch (err) {
        // Surface to the AdminTask queue so finance / ops can attempt
        // a manual ledger write — the wallet credit and decision still
        // stand.
        this.logger.error(
          `Liability ledger write failed for return ${ret.returnNumber}: ${(err as Error).message}`,
        );
        // Phase 13 — dedicated AdminTaskKind so finance/ops queue
        // can filter ledger backfills separately from generic OTHER
        // tasks.
        await this.liabilityLedger
          .enqueueAdminTask({
            kind: 'RETURN_LIABILITY_LEDGER_BACKFILL' as any,
            sourceType: 'RETURN' as any,
            sourceId: returnId,
            reason: `Liability ledger write failed for return ${ret.returnNumber}: ${(err as Error).message}`,
          })
          .catch(() => undefined);
      }
    }

    // Phase 97 (2026-05-23) — QC audit Gap #11 closure. Resolve the
    // RETURN_QC_PENDING AdminTask raised at mark-received so the
    // queue accurately reflects what's still outstanding. Best-effort
    // — failing to resolve the task is not fatal for QC; the SLA
    // breach cron will reconcile.
    try {
      await (this.prisma as any).adminTask.updateMany({
        where: {
          uniqueKey: `return-qc-pending:${returnId}`,
          status: { in: ['OPEN', 'CLAIMED'] },
        },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolvedBy: actorId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[return.qc_decided] AdminTask resolution failed for ${ret.returnNumber}: ${
          (err as Error)?.message ?? 'unknown error'
        }`,
      );
    }

    // Audit trail — records who decided what, when. The action key
    // is consumed by the admin audit log search UI and by external
    // compliance exports.
    this.audit
      .writeAuditLog({
        actorId,
        action: 'return.qc_decided',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: {
          status: ret.status,
          sellerResponseStatus: ret.sellerResponseStatus,
        },
        newValue: {
          status: newStatus,
          qcDecision,
          liabilityParty,
          customerRemedy,
          refundAmount: Number(refundAmount),
          // Stamp the override so the audit trail captures bypass cases —
          // a critical compliance signal for the fairness gate.
          overrodeSellerResponseWindow:
            liabilityParty === 'SELLER' &&
            ret.sellerResponseStatus === 'PENDING' &&
            !!input.overrideSellerResponseWindow,
          // Capture the HIGH-risk acknowledgement so risky refunds
          // are traceable in compliance reviews. Only stamps when the
          // gate actually fired (skips the common low/medium path).
          acknowledgedHighRisk:
            typeof ret.riskScore === 'number' && ret.riskScore >= 60
              ? !!input.acknowledgeHighRisk
              : undefined,
          riskScoreAtDecision: ret.riskScore ?? undefined,
          // Phase 13 completion — capture the new admin overrides on
          // the QC audit row so finance can audit unusual choices.
          refundMethodOverride: input.refundMethod ?? undefined,
          amountInPaiseOverride: input.amountInPaise ?? undefined,
          flaggedForSecondApproval: input.requiresApproval ?? undefined,
        },
        metadata: {
          returnNumber: ret.returnNumber,
          actorType,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.qc_decided] audit write failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    this.logger.log(
      `QC completed for return ${ret.returnNumber}: ${qcDecision}, refund=₹${refundAmount}, liability=${liabilityParty ?? 'n/a'}, remedy=${customerRemedy ?? 'n/a'}`,
    );

    // Phase 13 (P1.14) — kick off the replacement-order pipeline when
    // QC picks REPLACEMENT or EXCHANGE. Best-effort: a failure here
    // does NOT roll back the QC decision (status already advanced,
    // ledger already written if applicable). The
    // ReplacementOrderService leaves the return in
    // PENDING_STOCK_CHECK on failure so a retry endpoint can pick
    // it up; an AdminTask is also enqueued.
    if (
      customerRemedy === 'REPLACEMENT' ||
      customerRemedy === 'EXCHANGE'
    ) {
      this.replacementOrders
        .processReturn(returnId)
        .catch((err) => {
          this.logger.error(
            `Replacement-order creation failed for return ${ret.returnNumber}: ${(err as Error).message}`,
          );
        });
    }

    // Auto-initiate refund for QC_APPROVED / PARTIALLY_APPROVED with
    // refund > 0 — but skip when the customer chose a non-cash remedy
    // (REPLACEMENT / EXCHANGE) since money doesn't flow to the
    // customer's wallet in those paths. The replacement-fulfilment
    // flow handles its own optional partial refund (when EXCHANGE
    // resolves to REFUND_TO_CUSTOMER).
    const remedyTakesCashRefund =
      customerRemedy !== 'REPLACEMENT' && customerRemedy !== 'EXCHANGE';
    // Phase 100 (2026-05-23) — QC audit Gap #13 closure. When the
    // first admin flagged requiresApproval=true, the qcStatus stayed
    // AWAITING_SECOND_APPROVAL and the refund must NOT auto-initiate.
    // A second admin posts to /admin/refunds/:id/approve to release
    // the refund (existing refund-approval flow handles it).
    const refundGatedBySecondApproval = !!input.requiresApproval;
    if (
      remedyTakesCashRefund &&
      refundAmount > 0 &&
      !refundGatedBySecondApproval &&
      // Phase 109 — time-barred returns are refunded via the wallet
      // adjustment (above), not here. Skipping prevents the double-pay.
      !timebarWalletRouted &&
      (newStatus === 'QC_APPROVED' || newStatus === 'PARTIALLY_APPROVED')
    ) {
      try {
        await this.initiateRefund(
          returnId,
          'SYSTEM',
          actorId,
          input.refundMethod, // Phase 13 — admin can override at QC
        );
        this.logger.log(
          `Refund auto-initiated for return ${ret.returnNumber} after QC approval`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to auto-initiate refund for return ${ret.returnNumber}: ${(err as Error).message}`,
        );
        // Don't throw — QC succeeded; admin can manually initiate refund if needed
      }
    } else if (refundGatedBySecondApproval && refundAmount > 0) {
      this.logger.log(
        `Refund deferred for return ${ret.returnNumber} (requiresApproval=true) — awaiting second admin sign-off`,
      );
      // Raise an AdminTask so the second admin sees the case in the
      // queue. Unique on (returnId) so retries dedup.
      try {
        await (this.prisma as any).adminTask.upsert({
          where: { uniqueKey: `qc-second-approval:${returnId}` },
          update: {},
          create: {
            kind: 'OTHER' as any,
            uniqueKey: `qc-second-approval:${returnId}`,
            severity: 'HIGH',
            status: 'OPEN',
            title: `Second-admin approval needed for QC of ${ret.returnNumber}`,
            details: `First admin (${actorId}) flagged requiresApproval=true. Refund ₹${refundAmount} pending second sign-off.`,
            relatedResource: 'return',
            relatedResourceId: returnId,
            slaBreachAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        this.logger.warn(
          `[qc-second-approval] AdminTask upsert failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      }
    }

    return this.returnRepo.findByIdWithItems(returnId);
  }

  /**
   * Compute the total refund amount for a return based on the QC-approved
   * quantities. Used for the franchise path where the commission reversal
   * helper has already executed via the facade and only the local refund
   * total is needed for the return record.
   */
  private computeRefundAmount(returnRecord: any): number {
    let total = 0;
    for (const item of returnRecord.items ?? []) {
      const orderItem = item.orderItem;
      if (!orderItem) continue;
      const approvedQty = item.qcQuantityApproved || 0;
      // Partial-VALUE refunds scale the line total by the same fraction the
      // QC step applied (1 = full); keeps the franchise refund consistent
      // with the customer credit and the GST reversal.
      const valueFraction =
        typeof item.refundValueFraction === 'number' &&
        item.refundValueFraction >= 0 &&
        item.refundValueFraction <= 1
          ? item.refundValueFraction
          : 1;
      total += approvedQty * Number(orderItem.unitPrice) * valueFraction;
    }
    return Math.round(total * 100) / 100;
  }

  // ── Phase R3: Fulfillment node helpers ──────────────────────────────────

  async listReturnsForFulfillmentNode(params: {
    nodeType: 'SELLER' | 'FRANCHISE';
    nodeId: string;
    page: number;
    limit: number;
    status?: string;
  }) {
    const { returns, total } =
      await this.returnRepo.findReturnsForFulfillmentNode(params);
    return {
      returns,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.limit)),
      },
    };
  }

  async getReturnDetailForNode(
    returnId: string,
    nodeType: 'SELLER' | 'FRANCHISE',
    nodeId: string,
  ) {
    await this.assertNodeOwnsReturn(returnId, nodeType, nodeId);
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    return ret;
  }

  async assertNodeOwnsReturn(
    returnId: string,
    nodeType: 'SELLER' | 'FRANCHISE',
    nodeId: string,
  ): Promise<void> {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const subOrder = ret.subOrder;
    if (!subOrder) throw new NotFoundAppException('Sub-order not loaded');

    if (nodeType === 'SELLER' && subOrder.sellerId !== nodeId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    if (nodeType === 'FRANCHISE' && subOrder.franchiseId !== nodeId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
  }

  // ── Phase R4: Refund processing ─────────────────────────────────────────

  /**
   * Initiate refund processing for a QC_APPROVED or PARTIALLY_APPROVED return.
   * Transitions the return to REFUND_PROCESSING. Attempts gateway processing;
   * if the gateway cannot process (COD / stubbed), the return stays in
   * REFUND_PROCESSING and requires manual confirmation by an admin.
   */
  async initiateRefund(
    returnId: string,
    actorType: string,
    actorId: string,
    refundMethod?: string,
  ) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    if (ret.status === 'REFUND_PROCESSING' || ret.status === 'REFUNDED') {
      throw new BadRequestAppException(
        'Refund already in progress or completed',
      );
    }

    const validStatuses = ['QC_APPROVED', 'PARTIALLY_APPROVED'];
    if (!validStatuses.includes(ret.status)) {
      throw new BadRequestAppException(
        `Return must be QC_APPROVED or PARTIALLY_APPROVED to initiate refund (current: ${ret.status})`,
      );
    }

    // Phase 109 (2026-05-25) — a time-barred return is refunded ONLY via its
    // TIME_BARRED_CREDIT_NOTE wallet adjustment (finance-approved). Refuse a
    // direct gateway / instant-wallet refund here so a manual or retried call
    // can't pay the customer a second time on top of the adjustment.
    if (ret.creditNoteEligibilityStatus === 'TIME_BARRED') {
      throw new BadRequestAppException(
        'Refund for a time-barred return is routed via the GST wallet adjustment (finance approval); direct refund initiation is blocked.',
      );
    }

    if (!ret.refundAmount || Number(ret.refundAmount) <= 0) {
      throw new BadRequestAppException(
        'No refund amount calculated for this return',
      );
    }

    const masterOrder = ret.masterOrder;
    if (!masterOrder) {
      throw new BadRequestAppException(
        'Master order not loaded for this return',
      );
    }

    // Phase 13 completion — refundMethod is now respected when the
    // admin explicitly picks one at QC time (BANK_TRANSFER for high-
    // value cases, etc.). Defaults to WALLET — Sportsmart's
    // policy-default for returns since it's instant + has no
    // gateway dependency. A mis-clicked dropdown still falls back
    // to WALLET because the DTO's @IsOptional means undefined is
    // the typical value.
    const ALLOWED_RETURN_METHODS = new Set([
      'WALLET',
      'ORIGINAL_PAYMENT',
      'BANK_TRANSFER',
      'UPI',
      'COUPON',
      'MANUAL',
    ]);
    const detectedMethod =
      refundMethod && ALLOWED_RETURN_METHODS.has(refundMethod)
        ? refundMethod
        : 'WALLET';

    // Try gateway processing — refundMethod tells the gateway whether
    // to use wallet (synchronous) vs Razorpay/COD (async / manual).
    const gatewayResult = await this.refundGateway.processRefund({
      orderId: masterOrder.id,
      orderNumber: masterOrder.orderNumber,
      paymentMethod: masterOrder.paymentMethod,
      amount: Number(ret.refundAmount),
      // Phase 167 (#5) — precise paise (no Number truncation above ~₹90L).
      amountInPaise: ret.refundAmountInPaise ?? undefined,
      customerId: ret.customerId,
      returnId: ret.id,
      returnNumber: ret.returnNumber,
      refundMethod: detectedMethod,
    });

    // Audit: record the gateway attempt before updating return state.
    // amount is the source Decimal; routing through the dual-write
    // helper writes amountInPaise transactionally. Passing the
    // Decimal verbatim (not Number(...)) avoids the float-coercion
    // hazard PR 0.4's toPaise was built to refuse.
    await this.prisma.refundTransaction.create({
      data: this.moneyDualWrite.applyPaise('refundTransaction', {
        returnId,
        attemptNumber: (ret.refundAttempts ?? 0) + 1,
        amount: ret.refundAmount,
        gatewayRefundId: gatewayResult.gatewayRefundId ?? null,
        status: gatewayResult.success ? 'INITIATED' : 'FAILED',
        failureReason: gatewayResult.failureReason ?? null,
        actorType,
        actorId,
      }),
    });

    // Update return state. If the gateway settled synchronously (wallet
    // credit), jump straight to REFUNDED — there's no polling step.
    const finalStatus: 'REFUNDED' | 'REFUND_PROCESSING' = gatewayResult.completed
      ? 'REFUNDED'
      : 'REFUND_PROCESSING';

    const updateData: Record<string, unknown> = {
      status: finalStatus,
      refundMethod: detectedMethod,
      refundInitiatedBy: actorType,
      refundInitiatedAt: new Date(),
      refundAttempts: { increment: 1 },
      refundLastAttemptAt: new Date(),
    };

    if (gatewayResult.success && gatewayResult.gatewayRefundId) {
      updateData.refundReference = gatewayResult.gatewayRefundId;
      updateData.refundFailureReason = null;
    } else if (gatewayResult.failureReason) {
      updateData.refundFailureReason = gatewayResult.failureReason;
    }

    if (gatewayResult.completed) {
      updateData.refundProcessedAt = new Date();
    }

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      finalStatus,
      actorType,
      actorId,
      `Refund initiated — method: ${detectedMethod}${
        gatewayResult.completed
          ? ' (settled instantly via wallet)'
          : gatewayResult.requiresManualProcessing
          ? ' (manual processing required)'
          : ''
      }`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.initiated',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          refundAmount: Number(ret.refundAmount),
          refundMethod: detectedMethod,
          requiresManualProcessing: gatewayResult.requiresManualProcessing,
          gatewayRefundId: gatewayResult.gatewayRefundId,
        },
      });

      // Synchronous (wallet) refund: also emit the completed event so any
      // notification handlers fire immediately rather than waiting on a
      // separate confirmRefund call that will never come.
      if (gatewayResult.completed && gatewayResult.gatewayRefundId) {
        await this.eventBus.publish({
          eventName: 'returns.refund.completed',
          aggregate: 'Return',
          aggregateId: returnId,
          occurredAt: new Date(),
          payload: {
            returnId,
            returnNumber: ret.returnNumber,
            refundAmount: Number(ret.refundAmount),
            refundReference: gatewayResult.gatewayRefundId,
            processedBy: actorId,
          },
        });
      }
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail (initiation; completion fires from
    // confirmRefund and the saga's success path).
    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.refund_initiated',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: {
          status: finalStatus,
          refundAmount: Number(ret.refundAmount),
          refundMethod: detectedMethod,
          gatewayRefundId: gatewayResult.gatewayRefundId,
          completed: !!gatewayResult.completed,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);
    if (gatewayResult.completed && gatewayResult.gatewayRefundId) {
      this.audit
        .writeAuditLog({
          actorId,
          actorRole: actorType,
          action: 'return.refund_completed',
          module: 'returns',
          resource: 'return',
          resourceId: returnId,
          newValue: {
            refundAmount: Number(ret.refundAmount),
            refundReference: gatewayResult.gatewayRefundId,
          },
          metadata: { returnNumber: ret.returnNumber },
        })
        .catch(() => undefined);
    }

    this.logger.log(
      `Refund initiated for return ${ret.returnNumber}: ₹${ret.refundAmount} via ${detectedMethod}`,
    );

    return updated;
  }

  /**
   * Confirm that a refund has been completed (either by admin after manual
   * processing or after polling the gateway). Transitions REFUND_PROCESSING
   * to REFUNDED and records the refund reference.
   */
  async confirmRefund(
    returnId: string,
    actorType: string,
    actorId: string,
    input: ConfirmRefundInput,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to confirm refund (current: ${ret.status})`,
      );
    }

    // Phase 96 (2026-05-23) — Phase 98 audit Gap #9 / Gap #29 closure.
    //
    //   Gap #9  — confirmRefund accepted any admin-typed refundReference
    //             and stored it verbatim as the canonical gateway id.
    //             A malicious / careless admin could mark any return
    //             REFUNDED with any text.
    //   Gap #29 — same reference reused across multiple returns went
    //             undetected.
    //
    // Sanitize + reject blank + refuse if another return already owns
    // this reference. The gateway-side cross-check (for ONLINE methods)
    // belongs in a follow-up that adds a Razorpay-status poller; this
    // gates the trivially-spoofable case here.
    const trimmedRef = (input.refundReference ?? '').trim();
    if (trimmedRef.length === 0) {
      throw new BadRequestAppException(
        'refundReference is required and cannot be blank',
      );
    }
    if (trimmedRef.length > 256) {
      throw new BadRequestAppException(
        'refundReference is too long (max 256 chars)',
      );
    }
    const existingByRef = await this.prisma.return.findFirst({
      where: {
        refundReference: trimmedRef,
        id: { not: returnId },
      },
      select: { id: true, returnNumber: true },
    });
    if (existingByRef) {
      throw new BadRequestAppException(
        `refundReference '${trimmedRef}' already in use by return ${existingByRef.returnNumber}. Refusing to record a duplicate reference.`,
      );
    }

    const updateData: Record<string, unknown> = {
      status: 'REFUNDED',
      refundReference: trimmedRef,
      refundProcessedAt: new Date(),
      refundFailureReason: null,
    };
    if (input.refundMethod) updateData.refundMethod = input.refundMethod;

    const updated = await this.returnRepo.update(returnId, updateData);

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUNDED',
      actorType,
      actorId,
      input.notes || `Refund completed — reference: ${trimmedRef}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.completed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          refundAmount: Number(ret.refundAmount),
          refundReference: trimmedRef,
          processedBy: actorId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Refund confirmed for return ${ret.returnNumber}: ${trimmedRef}`,
    );
    return updated;
  }

  /**
   * Record a refund attempt failure. Return remains in REFUND_PROCESSING so
   * it can be retried. The failure reason and timestamp are captured.
   */
  async markRefundFailed(
    returnId: string,
    actorType: string,
    actorId: string,
    reason: string,
  ) {
    // Phase 101 (2026-05-23) — Phase 102 audit closures: #3 self-loop
    // history, #4 attempts not incremented, #5 no RefundTransaction
    // row, #6 RefundInstruction not updated, #7 markedFailedBy/At
    // columns, #10 no transaction, #12 race with confirmRefund.
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to mark refund failed (current: ${ret.status})`,
      );
    }

    const sanitizedReason = sanitizeRespondNotes(reason) ?? reason;
    const now = new Date();
    const newAttempts = (ret.refundAttempts ?? 0) + 1;
    const maxRetries = ret.refundMaxRetries ?? REFUND_MAX_RETRY_ATTEMPTS;
    const capReached = newAttempts >= maxRetries;
    const finalStatus: 'REFUND_PROCESSING' | 'REFUND_FAILED' = capReached
      ? 'REFUND_FAILED'
      : 'REFUND_PROCESSING';

    const outcome = await this.prisma.$transaction(async (tx) => {
      // Version-CAS lock so a concurrent confirmRefund can't race.
      let updated: any;
      try {
        updated = await tx.return.update({
          where: {
            id: returnId,
            version: (ret as any).version,
            status: 'REFUND_PROCESSING' as any,
          } as any,
          data: {
            status: finalStatus as any,
            refundFailureReason: sanitizedReason,
            // Phase 106 — Phase 102 audit Gap #14 closure. Sanitized
            // customer-facing mirror.
            refundFailureMessageCustomer: customerSafeRefundFailureMessage(
              capReached ? `cap exhausted: ${sanitizedReason}` : sanitizedReason,
            ),
            // Phase 106 — Phase 101 audit Gap #28 closure. Append to
            // bounded history ring (last 10 failures).
            refundFailureHistory: appendFailureHistory(
              (ret as any).refundFailureHistory,
              {
                attemptNumber: newAttempts,
                reason: sanitizedReason,
                actorType,
                actorId,
              },
            ) as any,
            refundLastAttemptAt: now,
            refundAttempts: { increment: 1 },
            // Phase 101 — Gap #14 null the gateway reference so the
            // poller cron stops asking Razorpay about a dead refund id
            // and the retry cron can pick the row up for re-attempt.
            refundReference: null,
            // Phase 101 — Gap #7 audit pointer.
            refundFailedBy: actorId,
            refundFailedByActor: actorType,
            refundFailedAt: now,
            version: { increment: 1 },
          } as any,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestAppException(
            'Return was modified by another process; please refresh and retry.',
          );
        }
        throw err;
      }

      // Phase 101 — Gap #5 closure. Per-attempt RefundTransaction row
      // mirrors the cron-retry path so the audit table reflects ALL
      // failure events (cron + manual).
      try {
        await tx.refundTransaction.create({
          data: {
            returnId,
            attemptNumber: newAttempts,
            amount: ret.refundAmount ?? 0,
            amountInPaise: (ret as any).refundAmountInPaise ?? BigInt(0),
            status: 'FAILED' as any,
            failureReason: sanitizedReason,
            actorType,
            actorId,
          } as any,
        });
      } catch (err: any) {
        // Conflict with concurrent cron retry that already inserted
        // the same attempt number — let it pass; the bookkeeping
        // serializes on the row.
        if (err?.code !== 'P2002') throw err;
      }

      // Phase 101 — Gap #3 closure. Use a meaningful from/to status
      // when we actually flipped (cap reached). Otherwise the
      // self-loop row is intentional ("attempt failed at <reason>" —
      // it's a refund-attempt log, not a state transition).
      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: 'REFUND_PROCESSING' as any,
          toStatus: finalStatus as any,
          changedBy: actorType,
          changedById: actorId,
          notes: capReached
            ? `Refund attempt #${newAttempts} failed and cap (${maxRetries}) reached: ${sanitizedReason}`
            : `Refund attempt #${newAttempts} failed: ${sanitizedReason}`,
        },
      });

      // Phase 101 — Gap #6 closure. Mirror the failure on any linked
      // RefundInstruction so the saga audit reflects the same outcome.
      try {
        await tx.refundInstruction.updateMany({
          where: {
            sourceType: 'RETURN' as any,
            sourceId: returnId,
            status: { in: ['PROCESSING', 'RETRYING', 'PENDING_APPROVAL'] as any },
          },
          data: {
            status: 'FAILED' as any,
            failureReason: sanitizedReason,
            attempts: { increment: 1 },
          },
        });
      } catch (err) {
        this.logger.warn(
          `[markRefundFailed] RefundInstruction mirror failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      }

      // Outbox publish inside tx so the customer-notification handler
      // is durably triggered.
      await this.eventBus.publish(
        {
          eventName: 'returns.refund.failed',
          aggregate: 'Return',
          aggregateId: returnId,
          occurredAt: now,
          payload: {
            returnId,
            returnNumber: ret.returnNumber,
            reason: sanitizedReason,
            attemptNumber: newAttempts,
            capReached,
            finalStatus,
          },
        },
        { tx },
      );

      return updated;
    });

    // Post-tx best-effort audit log + AdminTask. Failures here are
    // logged but do not roll back the markRefundFailed bookkeeping.
    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.refund_failed',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: 'REFUND_PROCESSING', attempts: ret.refundAttempts },
        newValue: {
          status: finalStatus,
          reason: sanitizedReason,
          attemptNumber: newAttempts,
          capReached,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.refund_failed] audit write failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    await this.liabilityLedger
      .enqueueAdminTask({
        kind: 'RETURN_REFUND_FAILED' as any,
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        reason: `Return ${ret.returnNumber} refund failed (attempt ${newAttempts}${capReached ? ' — cap reached' : ''}): ${sanitizedReason}`,
        slaHours: capReached ? 4 : undefined,
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Failed to enqueue AdminTask for refund-failure on return ${ret.returnNumber}: ${(err as Error).message}`,
        );
      });

    return outcome;
  }

  /**
   * Retry the refund gateway call for a return currently in REFUND_PROCESSING.
   * Enforces a maximum retry count. Attempt is recorded regardless of outcome.
   */
  async retryRefund(returnId: string, actorType: string, actorId: string) {
    // Phase 101 (2026-05-23) — Refund Retry audit Gap #13 closure.
    // Pre-Phase-101 a manual admin retry and the cron tick could both
    // call this method on the same return concurrently — both would
    // pass the refundAttempts < cap guard, both would call Razorpay,
    // and both would write RefundTransaction rows. The (returnId,
    // attemptNumber) unique catches the audit dup but the gateway
    // round-trip is wasted (Razorpay's own idempotency key dedups the
    // payout, but we still pay the latency).
    //
    // We now serialize the read+write under a SELECT ... FOR UPDATE
    // taken in a short tx. Concurrent callers wait briefly; the second
    // one re-reads the bumped state and either does its own attempt
    // or hits the cap. The Razorpay call itself happens OUTSIDE this
    // tx (long-running HTTP shouldn't hold a row lock), but the
    // attempt counter increment + audit row write that follow are
    // ordered against each other.
    const ret = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM returns WHERE id = $1 FOR UPDATE`,
        returnId,
      );
      return tx.return.findUnique({
        where: { id: returnId },
        include: { masterOrder: true, items: { include: { orderItem: true } } },
      });
    });
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to retry refund (current: ${ret.status})`,
      );
    }

    // Phase 101 (2026-05-23) — Refund Retry audit Gap #6 closure.
    // Per-return refundMaxRetries override wins over the env default.
    const envMaxRetries = this.env.getNumber(
      'REFUND_MAX_RETRY_ATTEMPTS' as any,
      REFUND_MAX_RETRY_ATTEMPTS,
    );
    const effectiveMaxRetries =
      (ret as any).refundMaxRetries ?? envMaxRetries;
    if ((ret.refundAttempts ?? 0) >= effectiveMaxRetries) {
      // Phase 100 (2026-05-23) — Phase 98 audit Gap #18 closure.
      // Flip the Return to REFUND_FAILED terminal so dashboards have
      // an explicit state for the human-triage queue. Best-effort
      // AdminTask (RETURN_REFUND_FAILED kind already exists in the
      // enum) so ops sees the case.
      try {
        await this.returnRepo.update(returnId, {
          status: 'REFUND_FAILED' as any,
          refundFailureReason: `Max retry attempts (${effectiveMaxRetries}) exhausted`,
          // Phase 106 — Phase 102 audit Gap #14 closure.
          refundFailureMessageCustomer: customerSafeRefundFailureMessage(
            'cap exhausted',
          ),
        });
        await this.returnRepo.recordStatusChange(
          returnId,
          ret.status,
          'REFUND_FAILED',
          actorType,
          actorId,
          `Retry cap (${effectiveMaxRetries}) exhausted; escalated for manual processing`,
        );
        await this.liabilityLedger
          .enqueueAdminTask({
            kind: 'RETURN_REFUND_FAILED' as any,
            sourceType: 'RETURN' as any,
            sourceId: returnId,
            reason: `Refund retry cap exhausted for return ${ret.returnNumber} (${effectiveMaxRetries} attempts)`,
            slaHours: 24,
          })
          .catch(() => undefined);
        // Publish exhaustion event so customer + admin notification
        // handlers fire.
        await this.eventBus.publish({
          eventName: 'returns.refund.exhausted_escalation',
          aggregate: 'Return',
          aggregateId: returnId,
          occurredAt: new Date(),
          payload: {
            returnId,
            returnNumber: ret.returnNumber,
            refundAmount: Number(ret.refundAmount),
            attempts: ret.refundAttempts,
            lastFailureReason: ret.refundFailureReason ?? null,
          },
        });
      } catch (err) {
        this.logger.error(
          `[retryRefund] failed to escalate ${ret.returnNumber} to REFUND_FAILED: ${(err as Error).message}`,
        );
      }
      throw new BadRequestAppException(
        `Maximum retry attempts (${effectiveMaxRetries}) exceeded for this refund. Return escalated to REFUND_FAILED for manual processing.`,
      );
    }

    const masterOrder = ret.masterOrder;
    if (!masterOrder) {
      throw new BadRequestAppException(
        'Master order not loaded for this return',
      );
    }

    // Phase 101 (2026-05-23) — Refund Retry audit Gap #25 closure.
    // Pre-Phase-101 the retry path didn't pass refundMethod through to
    // the gateway, so an admin who picked BANK_TRANSFER at initiate
    // would fall back to default WALLET on retry. Now the previous
    // method is honored.
    const gatewayResult = await this.refundGateway.processRefund({
      orderId: masterOrder.id,
      orderNumber: masterOrder.orderNumber,
      paymentMethod: masterOrder.paymentMethod,
      amount: Number(ret.refundAmount),
      // Phase 167 (#5) — precise paise (no Number truncation above ~₹90L).
      amountInPaise: ret.refundAmountInPaise ?? undefined,
      customerId: ret.customerId,
      returnId: ret.id,
      returnNumber: ret.returnNumber,
      refundMethod: ret.refundMethod ?? undefined,
    });

    // Phase 101 — Gap #12 closure. Per-attempt writes (recordRefundAttempt
    // + refundTransaction.create + recordStatusChange) now run inside
    // a single $transaction so a crash mid-sequence doesn't leave
    // attempts incremented without the audit row.
    const backoffMin = this.env.getNumber(
      'REFUND_RETRY_BACKOFF_MINUTES' as any,
      15,
    );
    const nextRetryAt = new Date(Date.now() + backoffMin * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      // Increment attempts + stamp gateway result + compute nextRetryAt.
      const data: Record<string, unknown> = {
        refundAttempts: { increment: 1 },
        refundLastAttemptAt: new Date(),
        refundNextRetryAt: nextRetryAt,
      };
      if (gatewayResult.success && gatewayResult.gatewayRefundId) {
        data.refundReference = gatewayResult.gatewayRefundId;
        data.refundFailureReason = null;
        // Phase 106 — clear the customer-facing message on success
        // so a previously-failed retry that finally lands doesn't
        // keep showing "we hit an issue" copy.
        data.refundFailureMessageCustomer = null;
      } else if (gatewayResult.failureReason) {
        data.refundFailureReason = gatewayResult.failureReason;
        // Phase 106 — Phase 102 audit Gap #14 closure. Customer-safe
        // mirror.
        data.refundFailureMessageCustomer = customerSafeRefundFailureMessage(
          gatewayResult.failureReason,
        );
        // Phase 106 — Phase 101 audit Gap #28 closure. Append to
        // bounded history ring.
        data.refundFailureHistory = appendFailureHistory(
          (ret as any).refundFailureHistory,
          {
            attemptNumber: (ret.refundAttempts ?? 0) + 1,
            reason: gatewayResult.failureReason,
            actorType,
            actorId,
          },
        ) as any;
      }
      await tx.return.update({
        where: { id: returnId },
        data: data as any,
      });

      // Phase 101 — Gap #21 dedup. (returnId, attemptNumber) is now
      // unique; P2002 means the cron + manual retry raced — let it pass.
      try {
        await tx.refundTransaction.create({
          data: this.moneyDualWrite.applyPaise('refundTransaction', {
            returnId,
            attemptNumber: (ret.refundAttempts ?? 0) + 1,
            amount: ret.refundAmount,
            gatewayRefundId: gatewayResult.gatewayRefundId ?? null,
            status: gatewayResult.success ? 'INITIATED' : 'FAILED',
            failureReason: gatewayResult.failureReason ?? null,
            actorType,
            actorId,
          }) as any,
        });
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }

      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: 'REFUND_PROCESSING' as any,
          toStatus: 'REFUND_PROCESSING' as any,
          changedBy: actorType,
          changedById: actorId,
          notes: `Refund retry attempt ${(ret.refundAttempts ?? 0) + 1}: ${
            gatewayResult.success
              ? 'succeeded'
              : gatewayResult.failureReason || 'failed'
          }`,
        },
      });
    });

    this.logger.log(
      `Refund retry for return ${ret.returnNumber}: ${
        gatewayResult.success ? 'succeeded' : 'failed'
      } (next attempt ${nextRetryAt.toISOString()})`,
    );

    return this.returnRepo.findByIdWithItems(returnId);
  }

  /**
   * Close a return — moves it to COMPLETED. Allowed from REFUNDED or
   * QC_REJECTED (in cases where there is nothing to refund).
   *
   * Phase 101 (2026-05-23) — Phase 103 audit closures.
   *
   *   Gap #2/#3 — closedBy + closeReason persistence.
   *   Gap #4/#5 — early-return on already-COMPLETED so duplicate calls
   *              do NOT overwrite the original closedAt and do NOT
   *              write a noop status-history row.
   */
  async closeReturn(
    returnId: string,
    actorType: string,
    actorId: string,
    reason?: string,
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    if (ret.status === 'COMPLETED') {
      this.logger.log(
        `Return ${ret.returnNumber} already COMPLETED; idempotent no-op (actor=${actorType}:${actorId})`,
      );
      return ret;
    }

    const sanitizedReason = sanitizeRespondNotes(reason);
    const closedAt = new Date();

    // Phase 105 (2026-05-23) — Phase 103 audit Gap #7 / Gap #8 closure.
    // Pre-Phase-105 the status update, history insert, event publish
    // and audit log were 4 sequential ops with no shared boundary —
    // a crash between the status flip and recordStatusChange would
    // leave a closed return with no audit row. We now wrap the
    // critical writes in a single $transaction and route the event
    // through the outbox (publish({ tx })) so delivery survives a
    // post-tx process crash. Assert FSM defensively so we still get
    // the 400 if the row isn't in REFUNDED/QC_REJECTED/REFUND_FAILED.
    assertTransition('ReturnStatus' as any, ret.status, 'COMPLETED' as any);

    const updated = await this.prisma.$transaction(async (tx) => {
      let row: any;
      try {
        row = await tx.return.update({
          where: { id: returnId, version: (ret as any).version } as any,
          data: {
            status: 'COMPLETED' as any,
            closedAt,
            closedBy: actorId,
            closedByActorType: actorType,
            closeReason: sanitizedReason,
            version: { increment: 1 },
          } as any,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestAppException(
            'Return was modified by another process; please refresh and retry.',
          );
        }
        throw err;
      }

      await tx.returnStatusHistory.create({
        data: {
          returnId,
          fromStatus: ret.status as any,
          toStatus: 'COMPLETED' as any,
          changedBy: actorType,
          changedById: actorId,
          notes: sanitizedReason
            ? `Return closed: ${sanitizedReason.slice(0, 200)}`
            : 'Return closed',
        },
      });

      await this.eventBus.publish(
        {
          eventName: 'returns.return.closed',
          aggregate: 'Return',
          aggregateId: returnId,
          occurredAt: closedAt,
          payload: {
            returnId,
            returnNumber: ret.returnNumber,
            closedBy: actorId,
            closedByActorType: actorType,
            closeReason: sanitizedReason,
            fromStatus: ret.status,
          },
        },
        { tx },
      );

      return row;
    });

    // Phase 103 audit Gap #21 — richer audit row including closedAt
    // and reason. Post-tx best-effort with explicit warn-on-failure
    // so audit gaps are observable.
    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.closed',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status, closedAt: null, version: (ret as any).version },
        newValue: {
          status: 'COMPLETED',
          closedAt,
          closeReason: sanitizedReason,
          version: ((ret as any).version ?? 0) + 1,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.closed] audit write failed for ${ret.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    this.logger.log(
      `Return ${ret.returnNumber} closed by ${actorType} ${actorId} (reason=${sanitizedReason ?? 'n/a'})`,
    );
    return updated;
  }

  // ── Analytics (Phase R6) ───────────────────────────────────────────────

  async getAnalytics(
    fromDate?: Date,
    toDate?: Date,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ) {
    return this.returnRepo.getAnalyticsSummary({ fromDate, toDate, allowedSellerTypes });
  }

  async getReturnsTrend(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ) {
    return this.returnRepo.getReturnsByPeriod({ fromDate, toDate, groupBy, allowedSellerTypes });
  }

  async getTopReturnReasons(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ) {
    return this.returnRepo.getTopReturnReasons(limit, fromDate, toDate, allowedSellerTypes);
  }

  async getCustomerReturnHistory(
    customerId: string,
    allowedSellerTypes?: ('D2C' | 'RETAIL')[],
  ) {
    return this.returnRepo.getReturnsByCustomer(customerId, allowedSellerTypes);
  }

  // ── Commission freeze / unfreeze helpers ──────────────────────────────
  //
  // Called from the return lifecycle so seller commissions follow the
  // customer's return journey in real time:
  //
  //   · Return created   → freeze   (PENDING → ON_HOLD)
  //   · Return rejected  → unfreeze (ON_HOLD → PENDING) — seller earns
  //   · Return cancelled → unfreeze (ON_HOLD → PENDING) — seller earns
  //   · QC fully rejects → unfreeze (ON_HOLD → PENDING) — seller earns
  //   · Return refunded  → existing reversal service flips ON_HOLD→REFUNDED
  //
  // SETTLED rows are NEVER touched here — those are payouts that already
  // happened; refund-transactions handle money reversal via a separate
  // ledger path. We only nudge records that are still in a pre-payout
  // state so the settlement cycle picks the right ones.

  private async freezeCommissionForSubOrder(subOrderId: string, reason: string) {
    const result = await this.prisma.commissionRecord.updateMany({
      where: { subOrderId, status: CommissionRecordStatus.PENDING },
      data: {
        status: CommissionRecordStatus.ON_HOLD,
        // Phase 137 — dedicated holdReason (no longer overloads adjustmentReason,
        // which the manual-adjust path owns). heldByAdminId stays null → marks
        // this a SYSTEM freeze, which the admin resume + the unfreeze tell apart
        // from an admin hold.
        holdReason: reason,
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Commission frozen for sub-order ${subOrderId}: ${result.count} record(s) PENDING → ON_HOLD (${reason})`,
      );
      // Phase 13 — audit trail for commission freeze (spec'd action).
      this.audit
        .writeAuditLog({
          actorRole: 'SYSTEM',
          action: 'commission.frozen',
          module: 'returns',
          resource: 'sub_order',
          resourceId: subOrderId,
          newValue: { count: result.count, reason },
        })
        .catch(() => undefined);
    }
  }

  // ── Phase 13 (P1.14 follow-up): EXCHANGE COLLECT_FROM_CUSTOMER ───────

  /**
   * Customer-facing call to start a Razorpay payment for the
   * outstanding exchange diff. Validates the return is in
   * AWAITING_PAYMENT, mints a Razorpay order for the diff amount,
   * and stamps the orderId on the return so the verify step can
   * cross-check.
   */
  async initiateExchangePayment(args: {
    returnId: string;
    customerId: string;
  }): Promise<{ razorpayOrderId: string; amountInPaise: number }> {
    const ret = await this.returnRepo.findById(args.returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.customerId !== args.customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    if (ret.replacementStatus !== 'AWAITING_PAYMENT') {
      throw new BadRequestAppException(
        `This return is not awaiting payment (status: ${ret.replacementStatus ?? 'none'})`,
      );
    }
    const diffPaise = ret.exchangePriceDiffPaise
      ? Number(ret.exchangePriceDiffPaise)
      : 0;
    if (diffPaise <= 0) {
      throw new BadRequestAppException(
        'No outstanding exchange diff for this return',
      );
    }

    // Phase 0 (PR 0.5) — adapter takes BigInt paise. diffPaise is
    // already paise as JS Number; coerce to bigint without going
    // through rupees.
    //
    // Phase 4 (PR 4.3) — idempotency key keyed on returnId so a
    // transient 5xx + retry dedupes at Razorpay. One return = one
    // exchange-diff order; replaying the request must converge on
    // the same gateway order, not mint a parallel one the customer
    // could mistakenly pay twice.
    const order = await this.razorpayAdapter.createOrder({
      amountInPaise: BigInt(diffPaise),
      receipt: `${ret.returnNumber}-XCHG`,
      notes: { returnId: ret.id, returnNumber: ret.returnNumber },
      idempotencyKey: `exchange-diff-${ret.id}`,
    });

    await this.prisma.return.update({
      where: { id: ret.id },
      data: { exchangeRazorpayOrderId: order.providerOrderId },
    });

    this.logger.log(
      `Return ${ret.returnNumber}: exchange-payment Razorpay order ${order.providerOrderId} for ₹${(diffPaise / 100).toFixed(2)}`,
    );

    return {
      razorpayOrderId: order.providerOrderId,
      amountInPaise: diffPaise,
    };
  }

  /**
   * Customer-facing call after Razorpay redirects with payment +
   * signature. Verifies HMAC, marks payment complete, and triggers
   * the replacement-order pipeline (which now finds stock and
   * proceeds, since payment is settled).
   */
  async verifyExchangePayment(args: {
    returnId: string;
    customerId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Promise<{ replacementOrderId: string | null; status: string }> {
    const ret = await this.returnRepo.findById(args.returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.customerId !== args.customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    if (ret.replacementStatus !== 'AWAITING_PAYMENT') {
      throw new BadRequestAppException(
        `Return is not awaiting payment (status: ${ret.replacementStatus ?? 'none'})`,
      );
    }
    if (
      !ret.exchangeRazorpayOrderId ||
      ret.exchangeRazorpayOrderId !== args.razorpayOrderId
    ) {
      throw new BadRequestAppException(
        'Razorpay orderId does not match the one on file for this return',
      );
    }

    const keySecret = this.env.getOptional('RAZORPAY_KEY_SECRET' as any);
    if (!keySecret) {
      throw new BadRequestAppException(
        'Payment verification unavailable — gateway not configured',
      );
    }
    const valid = verifyRazorpaySignature({
      razorpayOrderId: args.razorpayOrderId,
      razorpayPaymentId: args.razorpayPaymentId,
      razorpaySignature: args.razorpaySignature,
      keySecret,
    });
    if (!valid) {
      throw new BadRequestAppException(
        'Payment verification failed — invalid signature',
      );
    }

    // Mark payment complete + flip status so the replacement-order
    // pipeline takes over. processReturn re-classifies and creates
    // the actual order at ₹0 (the customer just paid the diff
    // separately via Razorpay; the replacement order itself stays
    // ₹0 — money flow is independent of order pricing).
    await this.prisma.return.update({
      where: { id: ret.id },
      data: {
        exchangePaymentCompletedAt: new Date(),
        // Flip back to PENDING_STOCK_CHECK so processReturn can run
        // its full classifier (stock check + decrement) end-to-end.
        // The classifier will see availability + the (now satisfied)
        // payment requirement and produce a PROCEED resolution.
        replacementStatus: 'PENDING_STOCK_CHECK' as any,
      },
    });

    this.audit
      .writeAuditLog({
        actorId: args.customerId,
        actorRole: 'CUSTOMER',
        action: 'return.exchange_payment_completed',
        module: 'returns',
        resource: 'return',
        resourceId: ret.id,
        newValue: {
          razorpayOrderId: args.razorpayOrderId,
          razorpayPaymentId: args.razorpayPaymentId,
          diffInPaise: Number(ret.exchangePriceDiffPaise ?? 0),
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    const result = await this.replacementOrders.processReturn(ret.id);
    return result ?? { replacementOrderId: null, status: 'PENDING_STOCK_CHECK' };
  }

  // ── Phase 13 (P1.8): seller-response lifecycle ───────────────────────

  /**
   * Seller's response to a return that alleged seller fault. Allowed
   * actions:
   *   - ACCEPTED: seller agrees with the claim. QC will proceed and
   *     SellerDebit becomes the natural ledger row.
   *   - CONTESTED: seller disagrees. They can attach evidence (via the
   *     existing ReturnEvidence table; uploadedBy='SELLER'). Admin
   *     reviews at QC time and is free to override liability.
   *
   * Throws if:
   *   - return doesn't exist
   *   - return belongs to a different seller
   *   - response status isn't PENDING (already accepted / contested /
   *     expired / never required)
   *   - the response window has lapsed (we accept up to 1 hour past
   *     due as a courtesy buffer; older windows redirect the seller
   *     to the admin UI)
   */
  async respondAsSeller(args: {
    returnId: string;
    sellerId: string;
    // The responding fulfillment node. Defaults to SELLER so the existing
    // seller path is unchanged; the franchise controller passes 'FRANCHISE'.
    // `sellerId` carries the actor id either way (sellerId or franchiseId).
    nodeType?: 'SELLER' | 'FRANCHISE';
    decision: 'ACCEPTED' | 'CONTESTED';
    notes?: string;
    evidenceFileUrls?: string[];
    // Phase 95 (2026-05-23) — Phase 94 deferred. Structured contest
    // reason for analytics. Free-text notes still allowed; this is
    // the categorical signal.
    contestReasonCategory?: string;
    // Phase 95 — Phase 94 deferred #20 partial-cart support. Each
    // entry overrides the top-level decision for the referenced
    // ReturnItem. Rollup: any CONTESTED item → top-level CONTESTED
    // (else top-level ACCEPTED).
    itemDecisions?: Array<{
      returnItemId: string;
      decision: 'ACCEPTED' | 'CONTESTED';
      note?: string;
    }>;
  }) {
    // Phase 94 (2026-05-23) — Seller/Franchise Return Response audit
    // pre-tx validation. Cheap checks first so we don't burn a tx slot
    // on obviously-bad payloads.
    //
    //   Gap #9  — evidence URL allowlist. Mirrors the create-return
    //             check; env-tunable via RETURN_EVIDENCE_ALLOWED_HOSTS.
    //   Gap #13 — notes sanitization. Strip control chars + cap length
    //             so the column + downstream HTML email never receive
    //             a 100MB blob or script-injection payload.
    if (args.evidenceFileUrls && args.evidenceFileUrls.length > 0) {
      const allowedHosts = resolveTrustedMediaHosts(
        this.env?.getOptional?.('R2_PUBLIC_BASE_URL' as any),
        this.env?.getOptional?.('RETURN_EVIDENCE_ALLOWED_HOSTS' as any),
      );
      const bad = validateEvidenceUrls(args.evidenceFileUrls, {
        allowedHosts,
      });
      if (bad) {
        throw new BadRequestAppException(
          `Evidence URL #${bad.index + 1} rejected: ${bad.reason}`,
        );
      }
    }
    const actorType = args.nodeType ?? 'SELLER';
    const sanitizedNotes = sanitizeRespondNotes(args.notes);

    // Phase 94 — Gap #4/#5/#7/#8 atomicity. Pre-Phase-94 the update,
    // evidence rows, status-history row and audit log fired as four
    // sequential statements. A crash after step 1 left the seller
    // marked CONTESTED with no evidence rows — QC saw the dispute
    // without the supporting photos. Wrapping everything in a
    // $transaction + threading the outbox publish through the same
    // tx (via `eventBus.publish({ tx })`) makes the whole respond
    // either fully committed or fully rolled back.
    //
    // Inside the tx we issue `SELECT ... FOR UPDATE` on the row first
    // — closes the TOCTOU window between the sweeper's `updateMany
    // WHERE sellerResponseStatus=PENDING` and this respond. Sweeper
    // also runs `FOR UPDATE SKIP LOCKED` now (see
    // sweepExpiredSellerResponses), so the two never race on the
    // same row.
    const respondedAt = new Date();
    let txOutcome: {
      updated: any;
      retSnapshot: any;
      evidenceCount: number;
      effectiveDecision: 'ACCEPTED' | 'CONTESTED';
    } | null = null;

    try {
      txOutcome = await this.prisma.$transaction(async (tx) => {
        // Pessimistic row lock so the sweeper (which now uses FOR
        // UPDATE SKIP LOCKED) can't flip PENDING→EXPIRED between our
        // read + write. If the sweeper holds the lock we wait briefly;
        // if it commits EXPIRED first our subsequent CAS bumps a 0-row
        // update and we surface a clean BadRequest.
        await tx.$queryRawUnsafe(
          `SELECT id FROM returns WHERE id = $1 FOR UPDATE`,
          args.returnId,
        );

        // Re-read INSIDE the tx so we see post-sweeper state.
        const ret = await tx.return.findUnique({
          where: { id: args.returnId },
          include: { subOrder: true },
        });
        if (!ret) {
          throw new NotFoundAppException('Return not found');
        }

        const ownerOnSubOrder =
          actorType === 'FRANCHISE'
            ? (ret as any).subOrder?.franchiseId
            : (ret as any).subOrder?.sellerId;
        if (!ownerOnSubOrder || ownerOnSubOrder !== args.sellerId) {
          throw new ForbiddenAppException(
            'You do not have access to this return',
          );
        }
        if (
          !ret.sellerResponseStatus ||
          ret.sellerResponseStatus === 'NOT_REQUIRED'
        ) {
          throw new BadRequestAppException(
            'No seller response is required for this return.',
          );
        }
        if (ret.sellerResponseStatus !== 'PENDING') {
          throw new BadRequestAppException(
            `Seller has already responded (${ret.sellerResponseStatus}).`,
          );
        }
        // Late-response courtesy window: up to 1 hour past due is
        // still accepted. Anything older redirects to admin support.
        // Phase 94 — Gap #16. Comment fix: the symmetric treatment of
        // ACCEPTED + CONTESTED inside the grace window is intentional
        // (a seller mid-typing at the deadline shouldn't lose their
        // submission). The "ACCEPTED is pointless once EXPIRED" line
        // from Phase 13 was misleading — the EXPIRED check above
        // already short-circuits that case.
        if (
          ret.sellerResponseDueAt &&
          ret.sellerResponseDueAt.getTime() + 60 * 60 * 1000 < Date.now()
        ) {
          throw new BadRequestAppException(
            'The seller response window has closed. Contact admin via support.',
          );
        }

        // Phase 95 (2026-05-23) — Phase 94 deferred #20 partial-cart
        // rollup. When the caller supplies itemDecisions, the
        // top-level decision becomes the rollup of all items: any
        // CONTESTED item → CONTESTED at the return level. If no
        // itemDecisions present, top-level decision is used for all
        // items (back-compat with the single-stance flow).
        const allReturnItems = await tx.returnItem.findMany({
          where: { returnId: args.returnId },
          select: { id: true },
        });
        const validItemIds = new Set(allReturnItems.map((i: any) => i.id));
        let effectiveDecision = args.decision;
        const perItem = new Map<string, { decision: 'ACCEPTED' | 'CONTESTED'; note?: string }>();
        if (args.itemDecisions && args.itemDecisions.length > 0) {
          for (const d of args.itemDecisions) {
            if (!validItemIds.has(d.returnItemId)) {
              throw new BadRequestAppException(
                `returnItemId ${d.returnItemId} does not belong to this return`,
              );
            }
            perItem.set(d.returnItemId, { decision: d.decision, note: d.note });
          }
          const anyContested = Array.from(perItem.values()).some(
            (v) => v.decision === 'CONTESTED',
          );
          effectiveDecision = anyContested ? 'CONTESTED' : 'ACCEPTED';
        } else {
          for (const it of allReturnItems) {
            perItem.set(it.id, { decision: args.decision });
          }
        }

        // Phase 94 — Gap #6 version CAS. `updateWithVersion` adds
        // `version: ret.version` to the WHERE; if a concurrent admin
        // reject / risk re-score bumped the version since our read,
        // the 0-row update raises P2025 which we translate into a
        // 409 ConflictAppException equivalent (BadRequest with a
        // retry hint here — the seller can refresh + try again).
        let updated: any;
        try {
          updated = await tx.return.update({
            where: { id: args.returnId, version: (ret as any).version } as any,
            data: {
              sellerResponseStatus: effectiveDecision as any,
              sellerRespondedAt: respondedAt,
              sellerResponseNotes: sanitizedNotes,
              sellerContestReasonCategory:
                effectiveDecision === 'CONTESTED'
                  ? args.contestReasonCategory ?? null
                  : null,
              version: { increment: 1 },
            } as any,
          });
        } catch (err: any) {
          if (err?.code === 'P2025') {
            throw new BadRequestAppException(
              'Return was modified by another process; please refresh and retry.',
            );
          }
          throw err;
        }

        // Phase 95 — write per-item rows inside the same tx.
        for (const [itemId, d] of perItem.entries()) {
          await tx.returnItem.update({
            where: { id: itemId },
            data: {
              sellerItemResponse: d.decision as any,
              sellerItemRespondedAt: respondedAt,
              sellerItemResponseNote: d.note
                ? sanitizeRespondNotes(d.note)
                : null,
            } as any,
          });
        }

        // Phase 94 — Gap #3/#4. Evidence rows write inside the same
        // tx so a crash between the status flip and the evidence
        // insert can't desync the two surfaces.
        let evidenceCount = 0;
        if (args.evidenceFileUrls && args.evidenceFileUrls.length > 0) {
          await tx.returnEvidence.createMany({
            data: args.evidenceFileUrls.map((url) => ({
              returnId: args.returnId,
              uploadedBy: actorType as any,
              uploaderId: args.sellerId,
              fileType: 'IMAGE',
              fileUrl: url,
              description: `${actorType === 'FRANCHISE' ? 'Franchise' : 'Seller'} ${args.decision.toLowerCase()} response evidence`,
            })),
          });
          evidenceCount = args.evidenceFileUrls.length;
        }

        // Phase 94 — Gap #15. Status-history breadcrumb. We keep the
        // self-loop row (fromStatus === toStatus) intentionally — the
        // admin UI surfaces this table as the chronological log of
        // everything that touched the return, and a seller respond is
        // exactly the kind of event that deserves a line there even
        // though the primary Return.status itself is unchanged. The
        // QC liability decision later writes its own row with a real
        // transition.
        await tx.returnStatusHistory.create({
          data: {
            returnId: args.returnId,
            fromStatus: ret.status as any,
            toStatus: ret.status as any,
            changedBy: actorType as any,
            changedById: args.sellerId,
            notes: `${actorType === 'FRANCHISE' ? 'Franchise' : 'Seller'} ${args.decision.toLowerCase()}${
              sanitizedNotes ? `: ${sanitizedNotes.slice(0, 200)}` : ''
            }`,
          },
        });

        // Phase 94 — Gap #10. Outbox publish INSIDE the tx so the
        // event row commits atomically with the status flip. Without
        // this, a crash between commit and emitAsync (or a failure of
        // the direct emit) would lose the event entirely.
        const itemDecisionCount = perItem.size;
        const contestedItemCount = Array.from(perItem.values()).filter(
          (v) => v.decision === 'CONTESTED',
        ).length;
        await this.eventBus.publish(
          {
            eventName: 'returns.seller.responded',
            aggregate: 'Return',
            aggregateId: args.returnId,
            occurredAt: respondedAt,
            payload: {
              returnId: args.returnId,
              returnNumber: ret.returnNumber,
              sellerId: args.sellerId,
              decision: effectiveDecision,
              contestReasonCategory:
                args.contestReasonCategory ?? null,
              itemDecisionCount,
              contestedItemCount,
              evidenceCount,
              hasNotes: !!sanitizedNotes && sanitizedNotes.length > 0,
            },
          },
          { tx },
        );

        return { updated, retSnapshot: ret, evidenceCount, effectiveDecision };
      });
    } catch (err) {
      throw err;
    }

    const { updated, retSnapshot, evidenceCount, effectiveDecision } =
      txOutcome!;

    // Phase 94 — Gap #17. Audit trail. Pre-Phase-94 `.catch(() =>
    // undefined)` silently swallowed audit failures, breaking
    // forensic + compliance review. We now surface as logger.warn —
    // the audit IS best-effort (audit failures must not block the
    // seller's response), but the loss should be observable.
    this.audit
      .writeAuditLog({
        actorId: args.sellerId,
        actorRole: actorType,
        action: 'return.seller_responded',
        module: 'returns',
        resource: 'return',
        resourceId: args.returnId,
        oldValue: { sellerResponseStatus: 'PENDING' },
        newValue: {
          sellerResponseStatus: effectiveDecision,
          requestedDecision: args.decision,
          contestReasonCategory: args.contestReasonCategory ?? null,
          notesLength: sanitizedNotes?.length ?? 0,
          evidenceCount,
          itemDecisionCount: args.itemDecisions?.length ?? 0,
        },
        metadata: { returnNumber: retSnapshot.returnNumber },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.seller_responded] audit write failed for ${retSnapshot.returnNumber}: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    this.logger.log(
      `Return ${retSnapshot.returnNumber}: seller ${args.sellerId} ${effectiveDecision} (notes=${sanitizedNotes?.length ?? 0}ch, evidence=${evidenceCount}, items=${args.itemDecisions?.length ?? 0})`,
    );

    return updated;
  }

  /**
   * Phase 95 (2026-05-23) — Phase 94 deferred #25 closure.
   *
   * Seller can flip their previous ACCEPTED↔CONTESTED while still
   * within the original window + 1h grace. Use case: a seller clicks
   * ACCEPTED on autopilot, then opens the QC photos and realises the
   * claim doesn't match the item — they should be able to switch to
   * CONTESTED without contacting support. Past the grace window the
   * decision is final; admin can still override at QC time.
   *
   * Same tx guarantees as respondAsSeller: row lock + version CAS +
   * outbox publish inside the tx + post-tx audit log.
   */
  async rescindSellerResponse(args: {
    returnId: string;
    sellerId: string;
    // Defaults to SELLER; franchise controller passes 'FRANCHISE'. `sellerId`
    // carries the actor id either way.
    nodeType?: 'SELLER' | 'FRANCHISE';
    newDecision: 'ACCEPTED' | 'CONTESTED';
    notes?: string;
    contestReasonCategory?: string;
  }) {
    const actorType = args.nodeType ?? 'SELLER';
    const sanitizedNotes = sanitizeRespondNotes(args.notes);
    const respondedAt = new Date();

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM returns WHERE id = $1 FOR UPDATE`,
        args.returnId,
      );
      const ret = await tx.return.findUnique({
        where: { id: args.returnId },
        include: { subOrder: true },
      });
      if (!ret) throw new NotFoundAppException('Return not found');
      const ownerOnSubOrder =
        actorType === 'FRANCHISE'
          ? (ret as any).subOrder?.franchiseId
          : (ret as any).subOrder?.sellerId;
      if (!ownerOnSubOrder || ownerOnSubOrder !== args.sellerId) {
        throw new ForbiddenAppException(
          'You do not have access to this return',
        );
      }
      // Rescind requires a prior ACCEPTED or CONTESTED — can't rescind
      // a never-submitted (PENDING) or expired response.
      if (
        ret.sellerResponseStatus !== 'ACCEPTED' &&
        ret.sellerResponseStatus !== 'CONTESTED'
      ) {
        throw new BadRequestAppException(
          `Rescind requires a prior ACCEPTED or CONTESTED response (current: ${ret.sellerResponseStatus ?? 'none'}).`,
        );
      }
      if (ret.sellerResponseStatus === args.newDecision) {
        throw new BadRequestAppException(
          `Already ${args.newDecision}; nothing to rescind.`,
        );
      }
      // Within window + 1h grace — same rule as respondAsSeller.
      if (
        ret.sellerResponseDueAt &&
        ret.sellerResponseDueAt.getTime() + 60 * 60 * 1000 < Date.now()
      ) {
        throw new BadRequestAppException(
          'The seller response window has closed. Contact admin via support.',
        );
      }

      let updated: any;
      try {
        updated = await tx.return.update({
          where: { id: args.returnId, version: (ret as any).version } as any,
          data: {
            sellerResponseStatus: args.newDecision as any,
            sellerRespondedAt: respondedAt,
            sellerResponseNotes: sanitizedNotes,
            sellerContestReasonCategory:
              args.newDecision === 'CONTESTED'
                ? args.contestReasonCategory ?? null
                : null,
            version: { increment: 1 },
          } as any,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestAppException(
            'Return was modified by another process; please refresh and retry.',
          );
        }
        throw err;
      }

      await tx.returnStatusHistory.create({
        data: {
          returnId: args.returnId,
          fromStatus: ret.status as any,
          toStatus: ret.status as any,
          changedBy: actorType as any,
          changedById: args.sellerId,
          notes: `${actorType === 'FRANCHISE' ? 'Franchise' : 'Seller'} rescinded ${ret.sellerResponseStatus?.toLowerCase()} → ${args.newDecision.toLowerCase()}${
            sanitizedNotes ? `: ${sanitizedNotes.slice(0, 200)}` : ''
          }`,
        },
      });

      await this.eventBus.publish(
        {
          eventName: 'returns.seller.response.rescinded',
          aggregate: 'Return',
          aggregateId: args.returnId,
          occurredAt: respondedAt,
          payload: {
            returnId: args.returnId,
            returnNumber: ret.returnNumber,
            sellerId: args.sellerId,
            fromDecision: ret.sellerResponseStatus,
            toDecision: args.newDecision,
          },
        },
        { tx },
      );

      return { updated, retSnapshot: ret };
    });

    this.audit
      .writeAuditLog({
        actorId: args.sellerId,
        actorRole: actorType,
        action: 'return.seller_response.rescinded',
        module: 'returns',
        resource: 'return',
        resourceId: args.returnId,
        oldValue: { sellerResponseStatus: outcome.retSnapshot.sellerResponseStatus },
        newValue: {
          sellerResponseStatus: args.newDecision,
          notesLength: sanitizedNotes?.length ?? 0,
        },
        metadata: { returnNumber: outcome.retSnapshot.returnNumber },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.seller_response.rescinded] audit write failed: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    return outcome.updated;
  }

  /**
   * Phase 95 (2026-05-23) — Phase 94 deferred #28 closure.
   *
   * Admin extends the seller-response window by N hours. Useful for
   * sellers who need extra time (out-of-office, holiday, evidence
   * gathering). Records who granted the extension + when so audit can
   * distinguish "seller responded inside their original window" from
   * "admin moved the goalpost".
   *
   * Caps at 168h (7 days) total extension so the customer's refund
   * doesn't sit indefinitely waiting on the seller.
   */
  async extendSellerResponseWindow(args: {
    returnId: string;
    adminId: string;
    additionalHours: number;
    reason?: string;
  }) {
    if (!Number.isFinite(args.additionalHours) || args.additionalHours <= 0) {
      throw new BadRequestAppException(
        'additionalHours must be a positive number',
      );
    }
    if (args.additionalHours > 168) {
      throw new BadRequestAppException(
        'Maximum extension is 168 hours (7 days). For longer holds, cancel the return + ask the customer to refile.',
      );
    }
    const sanitizedReason = sanitizeRespondNotes(args.reason);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM returns WHERE id = $1 FOR UPDATE`,
        args.returnId,
      );
      const ret = await tx.return.findUnique({ where: { id: args.returnId } });
      if (!ret) throw new NotFoundAppException('Return not found');
      if (ret.sellerResponseStatus !== 'PENDING') {
        throw new BadRequestAppException(
          `Window extension requires a PENDING response (current: ${ret.sellerResponseStatus ?? 'none'}).`,
        );
      }
      // Cumulative extension cap: don't allow stacking extensions
      // beyond 168h total.
      const existingExt = (ret as any).sellerResponseExtensionHours ?? 0;
      if (existingExt + args.additionalHours > 168) {
        throw new BadRequestAppException(
          `Cumulative extension (${existingExt + args.additionalHours}h) exceeds 168h cap.`,
        );
      }

      const baseDue = ret.sellerResponseDueAt ?? new Date();
      const newDue = new Date(
        baseDue.getTime() + args.additionalHours * 60 * 60 * 1000,
      );
      let row: any;
      try {
        row = await tx.return.update({
          where: { id: args.returnId, version: (ret as any).version } as any,
          data: {
            sellerResponseDueAt: newDue,
            sellerResponseExtendedBy: args.adminId,
            sellerResponseExtendedAt: new Date(),
            sellerResponseExtensionHours: existingExt + args.additionalHours,
            version: { increment: 1 },
          } as any,
        });
      } catch (err: any) {
        if (err?.code === 'P2025') {
          throw new BadRequestAppException(
            'Return was modified by another process; please refresh and retry.',
          );
        }
        throw err;
      }

      await tx.returnStatusHistory.create({
        data: {
          returnId: args.returnId,
          fromStatus: ret.status as any,
          toStatus: ret.status as any,
          changedBy: 'ADMIN',
          changedById: args.adminId,
          notes: `Seller response window extended by ${args.additionalHours}h to ${newDue.toISOString()}${
            sanitizedReason ? `: ${sanitizedReason.slice(0, 200)}` : ''
          }`,
        },
      });

      await this.eventBus.publish(
        {
          eventName: 'returns.seller.response.extended',
          aggregate: 'Return',
          aggregateId: args.returnId,
          occurredAt: new Date(),
          payload: {
            returnId: args.returnId,
            returnNumber: ret.returnNumber,
            adminId: args.adminId,
            additionalHours: args.additionalHours,
            newDueAt: newDue.toISOString(),
          },
        },
        { tx },
      );

      return row;
    });

    this.audit
      .writeAuditLog({
        actorId: args.adminId,
        actorRole: 'ADMIN',
        action: 'return.seller_response.extended',
        module: 'returns',
        resource: 'return',
        resourceId: args.returnId,
        newValue: {
          additionalHours: args.additionalHours,
          newDueAt: updated.sellerResponseDueAt,
          reason: sanitizedReason,
        },
      })
      .catch((err) => {
        this.logger.warn(
          `[return.seller_response.extended] audit write failed: ${
            (err as Error)?.message ?? 'unknown error'
          }`,
        );
      });

    return updated;
  }

  /**
   * Cron-callable sweeper. Flips PENDING → EXPIRED for any return
   * whose response window has elapsed. Returns the number of rows
   * updated for cron observability.
   *
   * Called from a separate cron module/controller; the service-level
   * helper here keeps the FSM logic near the rest of the return code.
   */
  async sweepExpiredSellerResponses(now: Date = new Date()): Promise<{
    expiredCount: number;
  }> {
    // Phase 94 (2026-05-23) — Seller/Franchise Return Response audit
    // Gap #15 / #16. Pre-Phase-94 the sweeper ran a single
    // `updateMany`, then logged the count. Problems closed here:
    //
    //   #15 — TOCTOU vs respondAsSeller. Without row-level locking,
    //         the sweeper could flip PENDING→EXPIRED in the millisecond
    //         after respondAsSeller read PENDING but before its update
    //         landed; the respond's update would then overwrite EXPIRED
    //         with ACCEPTED. We now grab `FOR UPDATE SKIP LOCKED` per
    //         batch so the respond + sweeper serialize cleanly.
    //   #15b — No per-row event/audit. Customer / admin couldn't get
    //         a signal when their window expired. We now publish
    //         `returns.seller.response.expired` per row + write a
    //         status_history breadcrumb so the forensic trail records
    //         which entity (cron) closed the window.
    //
    // Batched in 100-row chunks so a backlog flush doesn't hold an
    // unbounded number of row locks at once.
    const BATCH = 100;
    let totalExpired = 0;

    // We loop until the SELECT FOR UPDATE returns 0 candidates. Each
    // iteration runs in its own tx so a failure mid-batch only loses
    // that one batch's work and the next cron tick retries.
    /* eslint-disable no-constant-condition */
    while (true) {
      const expiredRows = await this.prisma.$transaction(async (tx) => {
        const candidates = await tx.$queryRawUnsafe<
          Array<{ id: string; return_number: string }>
        >(
          `SELECT id, return_number FROM returns
           WHERE seller_response_status = 'PENDING'
             AND seller_response_due_at IS NOT NULL
             AND seller_response_due_at < $1
           ORDER BY seller_response_due_at ASC
           LIMIT ${BATCH}
           FOR UPDATE SKIP LOCKED`,
          now,
        );
        if (candidates.length === 0) return [];

        const ids = candidates.map((r) => r.id);
        await tx.return.updateMany({
          where: { id: { in: ids } },
          data: { sellerResponseStatus: 'EXPIRED' as any },
        });

        // Per-row status_history breadcrumbs so the audit trail names
        // SYSTEM as the actor + flags the change as a window expiry.
        // ReturnStatusHistory.fromStatus/toStatus reflects the main
        // Return.status which is unchanged here; we use the `notes`
        // column to carry the seller-response transition string.
        const histRows = candidates.map((c) => ({
          returnId: c.id,
          fromStatus: null as any,
          toStatus: 'REQUESTED' as any, // placeholder; only the notes carry meaning
          changedBy: 'SYSTEM',
          changedById: null as any,
          notes: 'seller_response_status: PENDING → EXPIRED (window lapsed)',
        }));
        // Best-effort — failure here MUST NOT block the EXPIRED flip
        // (which is the primary purpose of the sweep). Log and move on.
        try {
          await tx.returnStatusHistory.createMany({ data: histRows as any });
        } catch (err) {
          this.logger.warn(
            `[seller-response sweeper] status history batch insert failed: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          );
        }

        // Outbox publish INSIDE the tx so each EXPIRED row gets a
        // durable event row. If the publish-loop crashes mid-batch
        // the entire tx rolls back, the rows stay PENDING, and the
        // next cron tick retries.
        for (const c of candidates) {
          await this.eventBus.publish(
            {
              eventName: 'returns.seller.response.expired',
              aggregate: 'Return',
              aggregateId: c.id,
              occurredAt: now,
              payload: {
                returnId: c.id,
                returnNumber: c.return_number,
                expiredAt: now.toISOString(),
              },
            },
            { tx },
          );
        }

        return candidates;
      });

      totalExpired += expiredRows.length;
      if (expiredRows.length < BATCH) break;
    }

    if (totalExpired > 0) {
      this.logger.log(
        `Seller-response sweeper expired ${totalExpired} return(s)`,
      );
      // Phase 214 (#9) — one best-effort SYSTEM summary audit row per sweep,
      // written OUTSIDE the per-batch transactions above so a logging blip
      // can never abort (or roll back) the EXPIRED flips. The per-row
      // status_history breadcrumbs + the durable `returns.seller.response.expired`
      // events remain the authoritative per-return trail; this row gives the
      // unified audit query a single "the cron expired N windows at T" entry.
      this.audit
        .writeAuditLog({
          actorType: 'SYSTEM',
          actorRole: 'SYSTEM',
          action: 'RETURN_SELLER_RESPONSE_SWEEP',
          module: 'returns',
          resource: 'return',
          resourceId: 'seller-response-sweeper',
          metadata: { expiredCount: totalExpired, sweptAt: now.toISOString() },
        })
        .catch((err) =>
          this.logger.warn(
            `[seller-response sweeper] summary audit write failed: ${
              (err as Error)?.message ?? 'unknown error'
            }`,
          ),
        );
    }
    return { expiredCount: totalExpired };
  }

  private async unfreezeCommissionForSubOrder(subOrderId: string, reason: string) {
    const result = await this.prisma.commissionRecord.updateMany({
      // Phase 137 — only lift SYSTEM freezes (heldByAdminId IS NULL). An admin
      // hold (heldByAdminId set) must NOT be auto-resumed by a return rejection;
      // it stays held until an admin explicitly resumes it.
      where: {
        subOrderId,
        status: CommissionRecordStatus.ON_HOLD,
        heldByAdminId: null,
      },
      data: {
        status: CommissionRecordStatus.PENDING,
        holdReason: null,
        // Phase 136 — stamp when an ON_HOLD record was restored to PENDING, so
        // a once-frozen-then-restored row is distinguishable from one that was
        // never frozen (both otherwise look like plain PENDING to settlement).
        unfrozenAt: new Date(),
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Commission unfrozen for sub-order ${subOrderId}: ${result.count} record(s) ON_HOLD → PENDING (${reason})`,
      );
      // Phase 13 — audit trail for commission reverse / unfreeze.
      this.audit
        .writeAuditLog({
          actorRole: 'SYSTEM',
          action: 'commission.reversed',
          module: 'returns',
          resource: 'sub_order',
          resourceId: subOrderId,
          newValue: { count: result.count, reason },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Reverse-logistics (delivery) charge billed to a seller on a SELLER-fault
   * return — the round-trip shipping cost their fault caused. Flat,
   * configurable per-return (RETURN_SELLER_DELIVERY_CHARGE_PAISE, default
   * ₹100); set to 0 to disable. Liability-scoped: only the SELLER_DEBIT path
   * calls this, so logistics/platform-fault returns never bill the seller.
   */
  private sellerReturnDeliveryChargePaise(): bigint {
    const flat = this.env.getNumber(
      'RETURN_SELLER_DELIVERY_CHARGE_PAISE',
      10000,
    );
    return flat > 0 ? BigInt(Math.round(flat)) : 0n;
  }

  /**
   * Option A — the amount recoverable from a seller-liable return.
   *
   * The platform may recover only the seller's NET settlement for the returned
   * units (the money it actually disbursed), never the gross customer refund.
   * It is 0 when the seller was never paid (COD / unsettled orders): the
   * platform already holds and refunds that money, so a SellerDebit would
   * double-recover it.
   *
   * "Paid" is read from the settlement LINK (commissionRecord.sellerSettlement
   * .paidAt), NOT from CommissionRecord.status — by the time this runs the QC
   * transaction has already flipped the record to REFUNDED, but it does not
   * clear the settlement link, so the paidAt signal survives. Per returned
   * unit we recover settlementPriceInPaise (order-time snapshot), falling back
   * to totalSettlementAmountInPaise / quantity if the per-unit column is unset.
   */
  private async computeSellerLiabilityRecoverablePaise(
    ret: any,
  ): Promise<bigint> {
    const approvedByItem = new Map<string, number>();
    for (const it of ret.items ?? []) {
      const orderItemId = it.orderItem?.id ?? it.orderItemId;
      const qty = it.qcQuantityApproved ?? 0;
      if (orderItemId && qty > 0) {
        approvedByItem.set(
          orderItemId,
          (approvedByItem.get(orderItemId) ?? 0) + qty,
        );
      }
    }
    if (approvedByItem.size === 0) return 0n;

    const records = await this.prisma.commissionRecord.findMany({
      where: { orderItemId: { in: Array.from(approvedByItem.keys()) } },
      select: {
        orderItemId: true,
        quantity: true,
        settlementPriceInPaise: true,
        totalSettlementAmountInPaise: true,
        sellerSettlement: { select: { paidAt: true } },
      },
    });

    let recoverable = 0n;
    for (const rec of records) {
      // Never paid out → nothing to recover from the seller (Option A).
      if (!rec.sellerSettlement?.paidAt) continue;
      const approvedQty = approvedByItem.get(rec.orderItemId) ?? 0;
      if (approvedQty <= 0) continue;
      const perUnit =
        rec.settlementPriceInPaise && rec.settlementPriceInPaise > 0n
          ? rec.settlementPriceInPaise
          : rec.quantity > 0
            ? rec.totalSettlementAmountInPaise / BigInt(rec.quantity)
            : 0n;
      recoverable += perUnit * BigInt(approvedQty);
    }
    return recoverable;
  }

  /**
   * Phase 13 — write the liability ledger row that records who pays
   * for this return refund. Idempotent on (sourceType=RETURN, sourceId).
   * Mapping mirrors ADR-016:
   *   SELLER     → SellerDebit (recovered from next settlement)
   *   LOGISTICS  → LogisticsClaim (filed against courier)
   *   PLATFORM   → PlatformExpense (Sportsmart absorbs)
   *   GOODWILL   → PlatformExpense w/ expenseType=GOODWILL
   * CUSTOMER and NONE never reach this helper (caller skips them).
   */
  private async recordReturnLiabilityLedger(args: {
    ret: any;
    returnId: string;
    liabilityParty: string;
    customerRemedy: string | null;
    amountInPaise: number;
    rationale: string;
    logistics?: { courierName?: string; awbNumber?: string };
  }): Promise<void> {
    const {
      ret,
      returnId,
      liabilityParty,
      customerRemedy,
      amountInPaise,
      rationale,
      logistics,
    } = args;

    if (amountInPaise <= 0) {
      // Nothing to recover or expense (zero-refund decision somehow
      // reached us). Skip silently — keeps the helper a pure
      // pass-through when there's no money to attribute.
      return;
    }

    const reasonText =
      rationale && rationale.trim().length > 0
        ? rationale.trim()
        : `Return ${ret.returnNumber} — ${customerRemedy ?? 'refund'}`;

    const ledger = mapReturnDecisionToLedger({
      liabilityParty: liabilityParty as ReturnLiabilityParty,
      customerRemedy: (customerRemedy ?? 'FULL_REFUND') as ReturnCustomerRemedy,
    });
    if (!ledger) return; // CUSTOMER / NONE → no row to write.

    if (ledger.kind === 'SELLER_DEBIT') {
      const sellerId = ret.subOrder?.sellerId;
      if (!sellerId) {
        throw new BadRequestAppException(
          'Cannot record SellerDebit — return is not linked to a seller-fulfilled sub-order. ' +
            'Pick liabilityParty=PLATFORM or LOGISTICS instead.',
        );
      }
      // Option A (seller-liability recovery basis). Recover only the seller's
      // NET settlement for the returned units — what the platform actually PAID
      // OUT — NOT the gross customer refund (`amountInPaise`). It is ₹0 when the
      // seller was never paid (COD / unsettled): the platform already holds and
      // refunds that money, so a SellerDebit would double-recover it. The
      // platform's own commission on a returned line is its loss (reversed via
      // CommissionRecord.refundedAdminEarning), not the seller's debt.
      const recoverablePaise =
        await this.computeSellerLiabilityRecoverablePaise(ret);

      // Seller-fault returns ALSO bill the seller the reverse-logistics
      // (delivery) charge their fault caused — even when the product value is
      // ₹0 (within-window / "seller never made the sale"), because the platform
      // still paid the courier for the round trip. Only the SELLER_DEBIT path
      // reaches here, so logistics/platform-fault returns never bill the seller.
      const deliveryChargePaise = this.sellerReturnDeliveryChargePaise();
      const { totalPaise, breakdown } = computeSellerReturnDebitPaise({
        productRecoverablePaise: recoverablePaise,
        deliveryChargePaise,
      });
      if (totalPaise <= 0n) {
        this.logger.log(
          `Return ${ret.returnNumber}: seller-liable but nothing to recover ` +
            `(no settled payout + ₹0 delivery charge) — no SellerDebit created.`,
        );
        return;
      }
      await this.liabilityLedger.recordSellerDebit({
        sellerId,
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        orderId: ret.masterOrderId,
        subOrderId: ret.subOrderId,
        amountInPaise: Number(totalPaise),
        reason: `${reasonText}${breakdown}`,
      });
      return;
    }
    if (ledger.kind === 'LOGISTICS_CLAIM') {
      await this.liabilityLedger.fileLogisticsClaim({
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        courierName: logistics?.courierName ?? null,
        awbNumber: logistics?.awbNumber ?? null,
        amountInPaise,
        reason: reasonText,
      });
      return;
    }
    if (ledger.kind === 'PLATFORM_EXPENSE') {
      await this.liabilityLedger.recordPlatformExpense({
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        expenseType: ledger.expenseType as any,
        amountInPaise,
        reason: reasonText,
      });
      return;
    }
  }
}
