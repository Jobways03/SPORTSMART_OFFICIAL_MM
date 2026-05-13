import { Inject, Injectable } from '@nestjs/common';
import { CommissionRecordStatus } from '@prisma/client';
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
import { RestockingFeeCalculator } from './restocking-fee.calculator';
import { CustomerAbuseCounterService } from './customer-abuse-counter.service';
import { CloudinaryAdapter } from '../../../../integrations/cloudinary/cloudinary.adapter';
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
import { MoneyDualWriteHelper } from '../../../../core/money/money-dual-write.helper';

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
    private readonly cloudinaryAdapter: CloudinaryAdapter,
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
    return this.env.getNumber('RETURN_QC_MIN_EVIDENCE', 0);
  }

  // ── Eligibility ────────────────────────────────────────────────────────

  async getOrderEligibility(masterOrderId: string, customerId: string) {
    return this.eligibilityService.checkOrderEligibility(
      masterOrderId,
      customerId,
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

    // Create return
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
    });

    // Persist the customer-supplied issue photos as ReturnEvidence rows
    // so QC has context and so forfeit cases are defensible.
    if (input.evidenceFileUrls && input.evidenceFileUrls.length > 0) {
      await this.prisma.returnEvidence.createMany({
        data: input.evidenceFileUrls.map((url) => ({
          returnId: created.id,
          uploadedBy: 'CUSTOMER',
          uploaderId: customerId,
          fileType: 'IMAGE',
          fileUrl: url,
          description: 'Customer-submitted issue evidence',
        })),
      });
    }

    // Phase 13 (P1.8) — seller-response lifecycle. If any item alleges
    // seller fault (DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED /
    // QUALITY_ISSUE / OTHER), open a 48h response window. Otherwise
    // mark NOT_REQUIRED so QC can proceed without waiting on the
    // seller (CHANGED_MIND, SIZE_FIT_ISSUE, DAMAGED_IN_TRANSIT).
    const sellerResponseRequirement = classifyReasonForSellerResponse(
      input.items.map((i) => i.reasonCategory),
    );
    if (sellerResponseRequirement === 'REQUIRED') {
      const notifiedAt = new Date();
      const dueAt = computeSellerResponseDueAt(notifiedAt);
      await this.prisma.return.update({
        where: { id: created.id },
        data: {
          sellerResponseStatus: 'PENDING' as any,
          sellerNotifiedAt: notifiedAt,
          sellerResponseDueAt: dueAt,
        },
      });
    } else {
      await this.prisma.return.update({
        where: { id: created.id },
        data: { sellerResponseStatus: 'NOT_REQUIRED' as any },
      });
    }

    // Log consent in the status history so there's an immutable record.
    await this.returnRepo.recordStatusChange(
      created.id,
      null,
      'REQUESTED',
      'CUSTOMER',
      customerId,
      'Customer acknowledged forfeit policy at submission',
    );

    // Freeze commission the moment a return is requested. Any PENDING
    // commission row tied to this sub-order flips to ON_HOLD so it
    // stops being eligible for the next settlement cycle. This covers
    // the race where commission was processed BEFORE the customer
    // decided to return. My earlier query-level guard handles the
    // other direction (return opened before processor tick).
    await this.freezeCommissionForSubOrder(
      subOrder.id,
      `Held pending return ${returnNumber}`,
    );

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

    // Phase 13 — audit trail.
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
      .catch(() => undefined);

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
      await this.returnRepo.update(created.id, {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: 'SYSTEM',
      });
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
    const { returns, total } = await this.returnRepo.findByCustomerId(
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
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) {
      throw new NotFoundAppException('Return not found');
    }
    if (ret.customerId !== customerId) {
      throw new ForbiddenAppException('You do not have access to this return');
    }
    return ret;
  }

  // ── Cancel ─────────────────────────────────────────────────────────────

  async cancelReturn(returnId: string, customerId: string) {
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

    const updated = await this.returnRepo.update(returnId, {
      status: 'CANCELLED',
      closedAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      fromStatus,
      'CANCELLED',
      'CUSTOMER',
      customerId,
      'Cancelled by customer',
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

    return {
      ...ret,
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
    // Lock commission immediately if it hasn't been processed yet.
    // The cron only picks up sub-orders past `returnWindowEndsAt`;
    // a same-day rejection would otherwise stall the seller's payout
    // for the rest of the window even though the case is closed.
    await this.triggerImmediateCommission(
      ret.subOrderId,
      `return-rejected:${ret.returnNumber}`,
    );

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
  ) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'RECEIVED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          receivedAt: new Date(),
          receivedBy: actorId,
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'RECEIVED',
      actorType,
      actorId,
      notes,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.received',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          receivedBy: actorId,
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
        action: 'return.received',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: { status: 'RECEIVED', notes },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} marked RECEIVED by ${actorType} ${actorId}`,
    );
    return updated;
  }

  /**
   * Upload a QC evidence image for a return (saved to Cloudinary).
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

    // Upload to Cloudinary
    const uploadResult = await this.cloudinaryAdapter.upload(fileBuffer, {
      folder: `returns/${returnId}/evidence`,
    });

    const evidence = await this.returnRepo.addEvidence({
      returnId,
      uploadedBy: actorType,
      uploaderId: actorId,
      fileType: fileMimetype,
      fileUrl: uploadResult.secureUrl,
      publicId: uploadResult.publicId,
      description,
    });

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
      // REJECTED / DAMAGED forfeit the customer's item + refund, so the
      // reason must be documented. Accept the reason from EITHER the
      // per-item note OR the overall notes — admins write wherever their
      // UI puts focus and we shouldn't be pedantic about which field as
      // long as *something* explains the decision to the customer.
      if (decision.qcOutcome === 'REJECTED' || decision.qcOutcome === 'DAMAGED') {
        const perItemOk = (decision.qcNotes ?? '').trim().length >= 15;
        const overallOk = (input.overallNotes ?? '').trim().length >= 15;
        if (!perItemOk && !overallOk) {
          throw new BadRequestAppException(
            `A ${decision.qcOutcome.toLowerCase()} decision requires a reason (min 15 characters) explaining what was found during inspection. Write it in the per-item Notes field or the Overall Notes field.`,
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

        const refundAmount =
          prorated !== null
            ? Number(prorated.totalRefundInPaise) / 100
            : decision.qcOutcome === 'REJECTED' ||
                decision.qcOutcome === 'DAMAGED'
              ? 0
              : grossRefund;

        return {
          returnItemId: decision.returnItemId,
          qcOutcome: decision.qcOutcome,
          qcQuantityApproved: decision.qcQuantityApproved,
          qcNotes: decision.qcNotes,
          refundAmount,
          // Carries through to the QC tx so we can write the
          // ReturnTaxReversalLine row + reverse liability ledger.
          reversalSnapshot: prorated?.reversalSnapshot ?? null,
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
            ? { ...it, qcQuantityApproved: decision.qcQuantityApproved }
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
            refundAmount: decision.refundAmount,
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
            ? { ...it, qcQuantityApproved: decision.qcQuantityApproved }
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
          qcCompletedAt: new Date(),
          qcDecision: qcDecision as any,
          qcNotes: input.overallNotes,
          refundAmount: totalRefund,
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
      // Same as the pre-pickup reject path: if commission hasn't
      // been processed yet (rare for QC because by the time the
      // item reaches the warehouse the window has usually elapsed,
      // but still possible in dev with the 2-min window), lock it
      // now so the seller doesn't sit on hold past case closure.
      await this.triggerImmediateCommission(
        ret.subOrderId,
        `qc-rejected:${ret.returnNumber}`,
      );
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
      .catch(() => undefined);

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
    if (
      remedyTakesCashRefund &&
      refundAmount > 0 &&
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
      total += approvedQty * Number(orderItem.unitPrice);
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

    const updateData: Record<string, unknown> = {
      status: 'REFUNDED',
      refundReference: input.refundReference,
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
      input.notes || `Refund completed — reference: ${input.refundReference}`,
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
          refundReference: input.refundReference,
          processedBy: actorId,
        },
      });
    } catch {
      // events are best-effort
    }

    this.logger.log(
      `Refund confirmed for return ${ret.returnNumber}: ${input.refundReference}`,
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
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to mark refund failed (current: ${ret.status})`,
      );
    }

    // Don't change status — keep as REFUND_PROCESSING so it can be retried.
    // Just record the failure.
    const updated = await this.returnRepo.update(returnId, {
      refundFailureReason: reason,
      refundLastAttemptAt: new Date(),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUND_PROCESSING',
      actorType,
      actorId,
      `Refund attempt failed: ${reason}`,
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.refund.failed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: {
          returnId,
          returnNumber: ret.returnNumber,
          reason,
          attemptNumber: (ret.refundAttempts ?? 0) + 1,
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
        action: 'return.refund_failed',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        newValue: {
          reason,
          attemptNumber: (ret.refundAttempts ?? 0) + 1,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    // Phase 13 — surface failed refunds to finance/ops via the AdminTask
    // queue so they don't depend on cron scraping for visibility. The
    // task is idempotent on (sourceType=RETURN, sourceId) — repeated
    // failures on the same return reuse the same task row instead of
    // spamming the queue, and ops sees the latest attempt count via
    // the linked return record.
    await this.liabilityLedger
      .enqueueAdminTask({
        kind: 'RETURN_REFUND_FAILED' as any,
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        reason: `Return ${ret.returnNumber} refund failed (attempt ${(ret.refundAttempts ?? 0) + 1}): ${reason}`,
      })
      .catch((err: unknown) => {
        // Best-effort — admin task creation failure shouldn't roll
        // back the refund-failed bookkeeping. Log and move on; the
        // audit log + ReturnStatusHistory still record the event.
        this.logger.error(
          `Failed to enqueue AdminTask for refund-failure on return ${ret.returnNumber}: ${(err as Error).message}`,
        );
      });

    return updated;
  }

  /**
   * Retry the refund gateway call for a return currently in REFUND_PROCESSING.
   * Enforces a maximum retry count. Attempt is recorded regardless of outcome.
   */
  async retryRefund(returnId: string, actorType: string, actorId: string) {
    const ret = await this.returnRepo.findByIdWithItems(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    if (ret.status !== 'REFUND_PROCESSING') {
      throw new BadRequestAppException(
        `Return must be REFUND_PROCESSING to retry refund (current: ${ret.status})`,
      );
    }

    if ((ret.refundAttempts ?? 0) >= REFUND_MAX_RETRY_ATTEMPTS) {
      throw new BadRequestAppException(
        `Maximum retry attempts (${REFUND_MAX_RETRY_ATTEMPTS}) exceeded for this refund`,
      );
    }

    const masterOrder = ret.masterOrder;
    if (!masterOrder) {
      throw new BadRequestAppException(
        'Master order not loaded for this return',
      );
    }

    // Try gateway again
    const gatewayResult = await this.refundGateway.processRefund({
      orderId: masterOrder.id,
      orderNumber: masterOrder.orderNumber,
      paymentMethod: masterOrder.paymentMethod,
      amount: Number(ret.refundAmount),
      customerId: ret.customerId,
      returnId: ret.id,
      returnNumber: ret.returnNumber,
    });

    await this.returnRepo.recordRefundAttempt(returnId, {
      gatewayRefundId: gatewayResult.gatewayRefundId,
      success: gatewayResult.success,
      failureReason: gatewayResult.failureReason,
    });

    // Audit row for this retry attempt. Same dual-write + Decimal
    // pass-through pattern as the initial-attempt write above.
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

    await this.returnRepo.recordStatusChange(
      returnId,
      'REFUND_PROCESSING',
      'REFUND_PROCESSING',
      actorType,
      actorId,
      `Refund retry attempt ${(ret.refundAttempts ?? 0) + 1}: ${
        gatewayResult.success
          ? 'succeeded'
          : gatewayResult.failureReason || 'failed'
      }`,
    );

    this.logger.log(
      `Refund retry for return ${ret.returnNumber}: ${
        gatewayResult.success ? 'succeeded' : 'failed'
      }`,
    );

    return this.returnRepo.findByIdWithItems(returnId);
  }

  /**
   * Close a return — moves it to COMPLETED. Allowed from REFUNDED or
   * QC_REJECTED (in cases where there is nothing to refund).
   */
  async closeReturn(returnId: string, actorType: string, actorId: string) {
    const ret = await this.returnRepo.findById(returnId);
    if (!ret) throw new NotFoundAppException('Return not found');

    const updated = await applyOptimisticTransition({
      kind: 'ReturnStatus',
      toStatus: 'COMPLETED',
      current: ret,
      update: (where, statusPatch) =>
        this.returnRepo.updateWithVersion(returnId, where.version, {
          ...statusPatch,
          closedAt: new Date(),
        }),
    });

    await this.returnRepo.recordStatusChange(
      returnId,
      ret.status,
      'COMPLETED',
      actorType,
      actorId,
      'Return closed',
    );

    try {
      await this.eventBus.publish({
        eventName: 'returns.return.closed',
        aggregate: 'Return',
        aggregateId: returnId,
        occurredAt: new Date(),
        payload: { returnId, returnNumber: ret.returnNumber },
      });
    } catch {
      // events are best-effort
    }

    // Phase 13 — audit trail
    this.audit
      .writeAuditLog({
        actorId,
        actorRole: actorType,
        action: 'return.closed',
        module: 'returns',
        resource: 'return',
        resourceId: returnId,
        oldValue: { status: ret.status },
        newValue: { status: 'COMPLETED' },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber} closed by ${actorType} ${actorId}`,
    );
    return updated;
  }

  // ── Analytics (Phase R6) ───────────────────────────────────────────────

  async getAnalytics(fromDate?: Date, toDate?: Date) {
    return this.returnRepo.getAnalyticsSummary({ fromDate, toDate });
  }

  async getReturnsTrend(
    fromDate: Date,
    toDate: Date,
    groupBy: 'day' | 'week' | 'month',
  ) {
    return this.returnRepo.getReturnsByPeriod({ fromDate, toDate, groupBy });
  }

  async getTopReturnReasons(limit: number, fromDate?: Date, toDate?: Date) {
    return this.returnRepo.getTopReturnReasons(limit, fromDate, toDate);
  }

  async getCustomerReturnHistory(customerId: string) {
    return this.returnRepo.getReturnsByCustomer(customerId);
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
        adjustmentReason: reason,
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
    decision: 'ACCEPTED' | 'CONTESTED';
    notes?: string;
    evidenceFileUrls?: string[];
  }) {
    const ret = await this.returnRepo.findByIdWithItems(args.returnId);
    if (!ret) throw new NotFoundAppException('Return not found');
    const sellerOnSubOrder = (ret as any).subOrder?.sellerId;
    if (!sellerOnSubOrder || sellerOnSubOrder !== args.sellerId) {
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
    // Late-response courtesy window: 1 hour past due is still accepted
    // since the seller may have started typing right at the deadline.
    // After that, they can talk to admin via support; CONTESTED stays
    // valid because admin can still override at QC, but ACCEPTED is
    // pointless once the cron has flipped the row to EXPIRED (handled
    // below — if cron beat the seller, sellerResponseStatus is EXPIRED
    // already and the previous check throws).
    if (
      ret.sellerResponseDueAt &&
      ret.sellerResponseDueAt.getTime() + 60 * 60 * 1000 < Date.now()
    ) {
      throw new BadRequestAppException(
        'The seller response window has closed. Contact admin via support.',
      );
    }

    const respondedAt = new Date();
    const updated = await this.prisma.return.update({
      where: { id: args.returnId },
      data: {
        sellerResponseStatus: args.decision as any,
        sellerRespondedAt: respondedAt,
        sellerResponseNotes: args.notes ?? null,
      },
    });

    // Optional evidence upload — reuse ReturnEvidence with
    // uploadedBy='SELLER'. ReturnEvidence already supports this value
    // (string column with admin / seller / customer / franchise).
    if (
      args.evidenceFileUrls &&
      args.evidenceFileUrls.length > 0
    ) {
      await this.prisma.returnEvidence.createMany({
        data: args.evidenceFileUrls.map((url) => ({
          returnId: args.returnId,
          uploadedBy: 'SELLER',
          uploaderId: args.sellerId,
          fileType: 'IMAGE',
          fileUrl: url,
          description: `Seller ${args.decision.toLowerCase()} response evidence`,
        })),
      });
    }

    // Status-history breadcrumb so the admin sees the seller's choice
    // chronologically alongside QC notes.
    await this.returnRepo.recordStatusChange(
      args.returnId,
      ret.status,
      ret.status,
      'SELLER',
      args.sellerId,
      `Seller ${args.decision.toLowerCase()}: ${(args.notes ?? '').slice(0, 200)}`,
    );

    // Audit trail
    this.audit
      .writeAuditLog({
        actorId: args.sellerId,
        actorRole: 'SELLER',
        action: 'return.seller_responded',
        module: 'returns',
        resource: 'return',
        resourceId: args.returnId,
        oldValue: { sellerResponseStatus: 'PENDING' },
        newValue: {
          sellerResponseStatus: args.decision,
          notes: args.notes,
          evidenceCount: args.evidenceFileUrls?.length ?? 0,
        },
        metadata: { returnNumber: ret.returnNumber },
      })
      .catch(() => undefined);

    this.logger.log(
      `Return ${ret.returnNumber}: seller ${args.sellerId} ${args.decision} (notes=${(args.notes ?? '').length}ch, evidence=${args.evidenceFileUrls?.length ?? 0})`,
    );

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
    const result = await this.prisma.return.updateMany({
      where: {
        sellerResponseStatus: 'PENDING' as any,
        sellerResponseDueAt: { lt: now },
      },
      data: {
        sellerResponseStatus: 'EXPIRED' as any,
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Seller-response sweeper expired ${result.count} return(s)`,
      );
      // Don't write per-row audit entries here (could be many on a
      // backlog flush) — the cron run row + per-return status history
      // when QC eventually decides covers the trail. If a per-row audit
      // is wanted later, do it inside the loop with batched audit writes.
    }
    return { expiredCount: result.count };
  }

  private async unfreezeCommissionForSubOrder(subOrderId: string, reason: string) {
    const result = await this.prisma.commissionRecord.updateMany({
      where: { subOrderId, status: CommissionRecordStatus.ON_HOLD },
      data: {
        status: CommissionRecordStatus.PENDING,
        adjustmentReason: reason,
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
      await this.liabilityLedger.recordSellerDebit({
        sellerId,
        sourceType: 'RETURN' as any,
        sourceId: returnId,
        orderId: ret.masterOrderId,
        subOrderId: ret.subOrderId,
        amountInPaise,
        reason: reasonText,
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
