// Phase 13 GST — WalletAdjustmentService.
//
// Owns the lifecycle of the `wallet_adjustments` table. Three entry
// points:
//
//   requestForTimeBarredReturn(returnId, ...)
//     Called when Section 34 blocks a credit note from being issued
//     for a QC-approved return. Looks up the source TaxDocument +
//     OrderItemTaxSnapshot rows, computes the "would-have-been" tax
//     reversal (so the absorbed GST is on record), creates a
//     `wallet_adjustment` in PENDING_APPROVAL (or APPROVED if below
//     the dual-approval threshold + auto-approve flag is on).
//
//   requestGoodwill(...)
//     Admin-initiated goodwill credit. No return / GST context;
//     `would_have_been_*` fields stay null. Same auto-approve gate
//     as time-barred.
//
//   requestManualDebit(...)
//     Admin-initiated debit (chargeback, fraud reversal). Stored
//     as a NEGATIVE amount. Always requires explicit approval.
//
//   approve(adjustmentId, adminId)
//     Posts the wallet_transactions row via WalletPublicFacade,
//     stamps approvedBy/approvedAt, sets walletTransactionId.
//
//   reject(adjustmentId, adminId, reason)
//     Terminal REJECTED. No money moves.
//
// Idempotency:
//   - Each request* method computes a deterministic idempotencyKey
//     (e.g. `TIME_BARRED_CREDIT_NOTE:${returnId}`). The UNIQUE index
//     on `idempotency_key` makes retries safe.
//   - approve() is idempotent on adjustmentId — if the row is already
//     APPROVED with a walletTransactionId, returns the existing state.
//   - The wallet ledger has its own UNIQUE on (referenceType,
//     referenceId, type) so even a hand-crafted double-approve can't
//     post twice.

import { Injectable, Logger, Optional } from '@nestjs/common';
import type {
  Prisma,
  WalletAdjustment,
  WalletAdjustmentKind,
  WalletAdjustmentStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../../bootstrap/env/env.service';
import { WalletPublicFacade } from '../../../wallet/application/facades/wallet-public.facade';
import { calculateGstReversal } from '../../../discounts/domain/tax/calculate-gst';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { NotificationsPublicFacade } from '../../../notifications/application/facades/notifications-public.facade';

// Phase 162 (Wallet Adjustments audit #5) — lifecycle events for downstream
// consumers (notifications, accounting export, finance dashboards).
export const WALLET_ADJUSTMENT_EVENTS = {
  REQUESTED: 'wallet.adjustment.requested',
  APPROVED: 'wallet.adjustment.approved',
  REJECTED: 'wallet.adjustment.rejected',
  REVERSED: 'wallet.adjustment.reversed',
} as const;

// Phase 162 (audit #4) — sentinel so an auto-approved row carries an explicit
// non-human approver id (never null, never the requester).
export const SYSTEM_AUTO_APPROVE = 'SYSTEM_AUTO_APPROVE';

export class WalletAdjustmentNotFoundError extends Error {
  constructor(public readonly adjustmentId: string) {
    super(`WalletAdjustment ${adjustmentId} not found`);
    this.name = 'WalletAdjustmentNotFoundError';
  }
}

export class WalletAdjustmentNotApprovableError extends Error {
  constructor(
    public readonly adjustmentId: string,
    public readonly currentStatus: WalletAdjustmentStatus,
  ) {
    super(
      `WalletAdjustment ${adjustmentId} cannot be approved from status ${currentStatus}`,
    );
    this.name = 'WalletAdjustmentNotApprovableError';
  }
}

export class WalletAdjustmentSelfApprovalError extends Error {
  constructor(
    public readonly adjustmentId: string,
    public readonly adminId: string,
  ) {
    super(
      `WalletAdjustment ${adjustmentId} cannot be approved by admin ${adminId} — they requested it`,
    );
    this.name = 'WalletAdjustmentSelfApprovalError';
  }
}

export class WalletAdjustmentDuplicateApproverError extends Error {
  constructor(
    public readonly adjustmentId: string,
    public readonly adminId: string,
  ) {
    super(
      `WalletAdjustment ${adjustmentId} cannot be approved by admin ${adminId} — they already provided the first approval`,
    );
    this.name = 'WalletAdjustmentDuplicateApproverError';
  }
}

export class WalletAdjustmentFirstApproverRoleError extends Error {
  constructor(
    public readonly adjustmentId: string,
    public readonly adminId: string,
  ) {
    super(
      `WalletAdjustment ${adjustmentId} cannot be first-approved by admin ${adminId} — first approval on a dual-approval row requires the Tax & Compliance Manager role (Super Admin is reserved for the second approval)`,
    );
    this.name = 'WalletAdjustmentFirstApproverRoleError';
  }
}

export class WalletAdjustmentSecondApproverRoleError extends Error {
  constructor(
    public readonly adjustmentId: string,
    public readonly adminId: string,
  ) {
    super(
      `WalletAdjustment ${adjustmentId} cannot be second-approved by admin ${adminId} — second approval requires Super Admin (or, when Super Admin is the requester, a different Tax & Compliance Manager)`,
    );
    this.name = 'WalletAdjustmentSecondApproverRoleError';
  }
}

/** Custom role name seeded by `seed-admin-rbac.ts` — must match exactly. */
const TAX_COMPLIANCE_MANAGER_ROLE_NAME = 'Tax & Compliance Manager';

export interface RequestForTimeBarredReturnArgs {
  returnId: string;
  /** Reason to surface to the customer + audit trail. Defaults to
   *  the Section 34 boilerplate when omitted. */
  reason?: string;
  requestedByAdminId?: string;
}

export interface RequestGoodwillArgs {
  customerId: string;
  amountInPaise: bigint | number;
  reason: string;
  requestedByAdminId: string;
}

export interface RequestManualDebitArgs {
  customerId: string;
  amountInPaise: bigint | number;
  reason: string;
  requestedByAdminId: string;
  /** Optional reference for audit traceability (e.g. dispute / chargeback id). */
  externalReferenceId?: string;
}

@Injectable()
export class WalletAdjustmentService {
  private readonly logger = new Logger(WalletAdjustmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly wallet: WalletPublicFacade,
    private readonly audit: AuditPublicFacade,
    @Optional() private readonly eventBus?: EventBusService,
    @Optional() private readonly notifications?: NotificationsPublicFacade,
  ) {}

  private dualApprovalThreshold(): bigint {
    return BigInt(
      this.env.getNumber(
        'WALLET_ADJUSTMENT_DUAL_APPROVAL_THRESHOLD_PAISE' as any,
        500_000,
      ),
    );
  }

  private autoApproveBelowThreshold(): boolean {
    // Default OFF so every wallet adjustment requires an explicit admin
    // approval click — Indian GST audits expect a named approver on
    // every refund row, not `approvedByAdminId: null`. Set the env
    // var to `true` to opt back into auto-approve for small refunds
    // (the original behaviour, useful in low-trust ops scenarios).
    return this.env.getBoolean(
      'WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD',
      false,
    );
  }

  /**
   * Time-barred refund path. Reads the return + source invoice +
   * snapshots, computes the absorbed-GST breakdown, persists the
   * adjustment. If under the dual-approval threshold and the
   * auto-approve flag is on, posts the wallet transaction inline.
   */
  async requestForTimeBarredReturn(
    args: RequestForTimeBarredReturnArgs,
  ): Promise<WalletAdjustment> {
    const ret = await this.prisma.return.findUnique({
      where: { id: args.returnId },
      include: { items: true },
    });
    if (!ret) throw new Error(`Return ${args.returnId} not found`);

    const approvedItems = ret.items.filter(
      (it) => (it.qcQuantityApproved ?? 0) > 0,
    );
    if (approvedItems.length === 0) {
      throw new Error(
        `Return ${ret.returnNumber}: no QC-approved items; nothing to adjust.`,
      );
    }

    // Find source invoice (same lookup as CreditNoteService). If
    // missing, fall back to a LEGACY_RECEIPT — Phase 14's non-tax
    // receipt for pre-GST orders gives us a stable sourceTaxDocumentId
    // to record on the adjustment audit trail. Legacy receipts carry
    // no GST claim, so the absorbed-GST snapshot stays null.
    let sourceInvoice = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId: ret.subOrderId,
        documentType: { in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'] },
      },
      orderBy: { generatedAt: 'desc' },
    });
    if (!sourceInvoice) {
      sourceInvoice = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId: ret.subOrderId,
          documentType: 'LEGACY_RECEIPT',
          status: { notIn: ['VOIDED_DRAFT'] },
        },
        orderBy: { generatedAt: 'desc' },
      });
    }
    const isLegacy = sourceInvoice?.documentType === 'LEGACY_RECEIPT';

    // Compute the absorbed-GST breakdown by reusing the credit-note
    // reversal math. If the source invoice is missing OR is a
    // LEGACY_RECEIPT (no GST data attached), the "would-have-been"
    // fields stay null — the refund still posts; the GST audit trail
    // just records the gap.
    let taxableInPaise = 0n;
    let cgstInPaise = 0n;
    let sgstInPaise = 0n;
    let igstInPaise = 0n;
    let totalTaxInPaise = 0n;
    let refundAmountInPaise = 0n;

    if (sourceInvoice && !isLegacy) {
      const orderItemIds = approvedItems.map((it) => it.orderItemId);
      const snapshots = await this.prisma.orderItemTaxSnapshot.findMany({
        where: { orderItemId: { in: orderItemIds } },
      });
      const snapshotByItem = new Map(
        snapshots.map((s) => [s.orderItemId!, s]),
      );

      for (const it of approvedItems) {
        const snap = snapshotByItem.get(it.orderItemId);
        if (!snap) continue;
        const orderItem = await this.prisma.orderItem.findUnique({
          where: { id: it.orderItemId },
          select: { quantity: true },
        });
        const purchased = orderItem?.quantity ?? 1;
        const returned = it.qcQuantityApproved ?? 0;
        if (returned <= 0 || returned > purchased) continue;

        const r = calculateGstReversal({
          originalGrossInPaise: snap.grossLineAmountInPaise,
          originalDiscountInPaise: snap.discountAmountInPaise,
          originalCgstInPaise: snap.cgstAmountInPaise,
          originalSgstInPaise: snap.sgstAmountInPaise,
          originalIgstInPaise: snap.igstAmountInPaise,
          purchasedQuantity: purchased,
          returnedQuantity: returned,
        });
        taxableInPaise += r.taxableReversalInPaise;
        cgstInPaise += r.cgstReversalInPaise;
        sgstInPaise += r.sgstReversalInPaise;
        igstInPaise += r.igstReversalInPaise;
        totalTaxInPaise += r.totalTaxReversalInPaise;
        refundAmountInPaise += r.totalCreditNoteInPaise;
      }
    }

    // If we couldn't compute a refund amount from snapshots (legacy
    // order) fall back to the return's refundAmountInPaise column.
    if (refundAmountInPaise === 0n && ret.refundAmountInPaise) {
      refundAmountInPaise = ret.refundAmountInPaise;
    }
    if (refundAmountInPaise === 0n) {
      throw new Error(
        `Return ${ret.returnNumber}: could not determine refund amount ` +
          `(no snapshots + no refundAmountInPaise on return row).`,
      );
    }

    const reason =
      args.reason ??
      (isLegacy
        ? `Legacy order — LEGACY_RECEIPT ${sourceInvoice?.documentNumber}; ` +
          `no GST output liability to reverse, refund routed via wallet.`
        : `Section 34 time-bar — GST credit-note window has lapsed for ` +
          `invoice ${sourceInvoice?.documentNumber ?? '(legacy)'}; ` +
          `refund routed via wallet adjustment and platform absorbs GST cost.`);

    return this.createAdjustment({
      customerId: ret.customerId,
      kind: 'TIME_BARRED_CREDIT_NOTE',
      amountInPaise: refundAmountInPaise,
      reason,
      subOrderId: ret.subOrderId,
      returnId: ret.id,
      sourceTaxDocumentId: sourceInvoice?.id ?? null,
      // Legacy receipts carry no absorbed-GST snapshot — there was
      // no GST claim to absorb in the first place.
      wouldHaveBeenTaxableInPaise: sourceInvoice && !isLegacy ? taxableInPaise : null,
      wouldHaveBeenCgstInPaise: sourceInvoice && !isLegacy ? cgstInPaise : null,
      wouldHaveBeenSgstInPaise: sourceInvoice && !isLegacy ? sgstInPaise : null,
      wouldHaveBeenIgstInPaise: sourceInvoice && !isLegacy ? igstInPaise : null,
      wouldHaveBeenTotalTaxInPaise: sourceInvoice && !isLegacy ? totalTaxInPaise : null,
      idempotencyKey: `TIME_BARRED_CREDIT_NOTE:${ret.id}`,
      requestedByAdminId: args.requestedByAdminId ?? null,
    });
  }

  /** Admin-initiated goodwill credit. */
  async requestGoodwill(args: RequestGoodwillArgs): Promise<WalletAdjustment> {
    const amount = BigInt(args.amountInPaise);
    if (amount <= 0n) {
      throw new Error('Goodwill credit amount must be positive');
    }
    return this.createAdjustment({
      customerId: args.customerId,
      kind: 'GOODWILL',
      amountInPaise: amount,
      reason: args.reason,
      subOrderId: null,
      returnId: null,
      sourceTaxDocumentId: null,
      wouldHaveBeenTaxableInPaise: null,
      wouldHaveBeenCgstInPaise: null,
      wouldHaveBeenSgstInPaise: null,
      wouldHaveBeenIgstInPaise: null,
      wouldHaveBeenTotalTaxInPaise: null,
      idempotencyKey:
        `GOODWILL:${args.requestedByAdminId}:${args.customerId}:${amount}:${args.reason.slice(0, 64)}`,
      requestedByAdminId: args.requestedByAdminId,
    });
  }

  /** Admin-initiated debit (chargeback, fraud reversal). Always
   *  requires explicit approval — never auto-approves. */
  async requestManualDebit(args: RequestManualDebitArgs): Promise<WalletAdjustment> {
    const amount = BigInt(args.amountInPaise);
    if (amount <= 0n) {
      throw new Error('Manual debit amount must be positive (sign applied internally)');
    }
    return this.createAdjustment({
      customerId: args.customerId,
      kind: 'MANUAL_DEBIT',
      // Persist as a negative number so the wallet posting code
      // doesn't need to re-interpret based on kind.
      amountInPaise: -amount,
      reason: args.reason,
      subOrderId: null,
      returnId: null,
      sourceTaxDocumentId: null,
      wouldHaveBeenTaxableInPaise: null,
      wouldHaveBeenCgstInPaise: null,
      wouldHaveBeenSgstInPaise: null,
      wouldHaveBeenIgstInPaise: null,
      wouldHaveBeenTotalTaxInPaise: null,
      idempotencyKey:
        `MANUAL_DEBIT:${args.requestedByAdminId}:${args.customerId}:${amount}:` +
        `${args.externalReferenceId ?? args.reason.slice(0, 64)}`,
      requestedByAdminId: args.requestedByAdminId,
      // Manual debits always require explicit approval, regardless of size.
      forceDualApproval: true,
    });
  }

  /** Approve a pending adjustment. State machine:
   *
   *    PENDING_APPROVAL (single approval) ──┐
   *                                          ├──► APPROVED (posts to wallet)
   *    PENDING_APPROVAL (dual) ──► FIRST_APPROVED ──► APPROVED
   *
   *  Rules:
   *  - The requester (if non-null) cannot be either approver.
   *  - For dual-approval rows, the second approver must differ from the
   *    first approver.
   *  - Idempotent on adjustmentId — re-calling on an APPROVED row returns
   *    the existing state without re-posting.
   */
  async approve(args: {
    adjustmentId: string;
    approvedByAdminId: string;
  }): Promise<WalletAdjustment> {
    const adj = await this.prisma.walletAdjustment.findUnique({
      where: { id: args.adjustmentId },
    });
    if (!adj) throw new WalletAdjustmentNotFoundError(args.adjustmentId);

    if (adj.status === 'APPROVED') return adj; // idempotent
    if (adj.status !== 'PENDING_APPROVAL' && adj.status !== 'FIRST_APPROVED') {
      throw new WalletAdjustmentNotApprovableError(args.adjustmentId, adj.status);
    }

    // The requester (when named) is barred from approving at any step —
    // strict separation of duties. Time-barred refunds are system-initiated
    // with `requestedByAdminId: null`, so this check no-ops there.
    if (
      adj.requestedByAdminId != null &&
      adj.requestedByAdminId === args.approvedByAdminId
    ) {
      throw new WalletAdjustmentSelfApprovalError(
        args.adjustmentId,
        args.approvedByAdminId,
      );
    }

    // Single-approval path: post immediately. No role restriction beyond
    // wallet.adjustment.approve (which the controller already enforces).
    if (!adj.requiresDualApproval) {
      return this.postAdjustment(adj, args.approvedByAdminId);
    }

    // ── Dual-approval role gates ──────────────────────────────────
    // Business rule: first approval must be by a Tax & Compliance Manager
    // (NOT Super Admin); second approval must be by Super Admin. Fallback:
    // when Super Admin is the requester (and therefore blocked from step 2),
    // a different Tax & Compliance Manager can complete step 2 instead —
    // otherwise the row would be permanently stuck.

    const approverIsSuperAdmin = await this.isSuperAdmin(args.approvedByAdminId);
    const approverIsTaxMgr = await this.hasTaxComplianceManagerRole(
      args.approvedByAdminId,
    );

    // Dual-approval, first sign-off.
    if (adj.status === 'PENDING_APPROVAL') {
      if (approverIsSuperAdmin || !approverIsTaxMgr) {
        throw new WalletAdjustmentFirstApproverRoleError(
          args.adjustmentId,
          args.approvedByAdminId,
        );
      }
      const updated = await this.prisma.walletAdjustment.update({
        where: { id: adj.id },
        data: {
          status: 'FIRST_APPROVED',
          firstApprovedByAdminId: args.approvedByAdminId,
          firstApprovedAt: new Date(),
        },
      });
      // Phase 162 (#1/#11) — capture the first sign-off in history + audit.
      await this.recordHistory(updated, 'FIRST_APPROVED', 'PENDING_APPROVAL', 'FIRST_APPROVED', args.approvedByAdminId, null);
      await this.writeAudit(args.approvedByAdminId, 'wallet.adjustment.first_approved', updated, adj, updated);
      this.logger.log(
        `WalletAdjustment ${updated.id} FIRST_APPROVED by ${args.approvedByAdminId} ` +
          `— awaiting second approval`,
      );
      return updated;
    }

    // Dual-approval, second sign-off (status === 'FIRST_APPROVED').
    if (adj.firstApprovedByAdminId === args.approvedByAdminId) {
      throw new WalletAdjustmentDuplicateApproverError(
        args.adjustmentId,
        args.approvedByAdminId,
      );
    }

    // Primary path: Super Admin completes step 2.
    // Fallback path: requester WAS Super Admin → a different TaxMgr can
    // complete step 2 (the requester-blocked Super Admin is the only one
    // who'd normally fit, so we widen the gate to keep the row clearable).
    const requesterWasSuperAdmin =
      adj.requestedByAdminId != null &&
      (await this.isSuperAdmin(adj.requestedByAdminId));
    const fallbackAllowed = requesterWasSuperAdmin && approverIsTaxMgr;
    if (!approverIsSuperAdmin && !fallbackAllowed) {
      throw new WalletAdjustmentSecondApproverRoleError(
        args.adjustmentId,
        args.approvedByAdminId,
      );
    }

    return this.postAdjustment(adj, args.approvedByAdminId);
  }

  /** True iff the admin's primary role is SUPER_ADMIN. */
  private async isSuperAdmin(adminId: string): Promise<boolean> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      select: { role: true },
    });
    return admin?.role === 'SUPER_ADMIN';
  }

  /** True iff the admin holds the Tax & Compliance Manager custom role. */
  private async hasTaxComplianceManagerRole(adminId: string): Promise<boolean> {
    const assignment = await this.prisma.adminRoleAssignment.findFirst({
      where: {
        adminId,
        role: { name: TAX_COMPLIANCE_MANAGER_ROLE_NAME },
      },
      select: { id: true },
    });
    return assignment !== null;
  }

  /** Reject a pending adjustment. No money moves.
   *
   *  Side-effects beyond the status flip:
   *    1. The unique `idempotencyKey` is suffixed with `:rejected-<ts>`
   *       so the canonical key (e.g. `TIME_BARRED_CREDIT_NOTE:<returnId>`)
   *       is freed for a fresh retry. Otherwise the next `Route to wallet`
   *       click on the same return would just return this rejected row.
   *    2. For TIME_BARRED_CREDIT_NOTE kind, the linked Return's
   *       `financeReviewedAt/By` are cleared so the timebar-review queue
   *       UI treats the return as actionable again. Without this the
   *       customer would be stuck — money owed, no path forward.
   */
  async reject(args: {
    adjustmentId: string;
    rejectedByAdminId: string;
    rejectionReason: string;
  }): Promise<WalletAdjustment> {
    const adj = await this.prisma.walletAdjustment.findUnique({
      where: { id: args.adjustmentId },
    });
    if (!adj) throw new WalletAdjustmentNotFoundError(args.adjustmentId);
    if (adj.status === 'REJECTED') return adj; // idempotent
    if (adj.status !== 'PENDING_APPROVAL' && adj.status !== 'FIRST_APPROVED') {
      throw new Error(
        `WalletAdjustment ${args.adjustmentId} cannot be rejected from status ${adj.status}`,
      );
    }

    const rejectedAt = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      // Phase 162 (#8) — CAS: guard the status transition so two concurrent
      // rejects can't both "win" and race on the Return.financeReviewedAt clear.
      const cas = await tx.walletAdjustment.updateMany({
        where: {
          id: args.adjustmentId,
          status: { in: ['PENDING_APPROVAL', 'FIRST_APPROVED'] },
        },
        data: {
          status: 'REJECTED',
          rejectedByAdminId: args.rejectedByAdminId,
          rejectedAt,
          rejectionReason: args.rejectionReason,
          idempotencyKey: `${adj.idempotencyKey}:rejected-${rejectedAt.getTime()}`,
        },
      });
      if (cas.count === 0) {
        const fresh = await tx.walletAdjustment.findUniqueOrThrow({
          where: { id: args.adjustmentId },
        });
        if (fresh.status === 'REJECTED') return fresh; // another rejecter won — idempotent
        throw new WalletAdjustmentNotApprovableError(args.adjustmentId, fresh.status);
      }
      const updated = await tx.walletAdjustment.findUniqueOrThrow({
        where: { id: args.adjustmentId },
      });

      if (adj.kind === 'TIME_BARRED_CREDIT_NOTE' && adj.returnId) {
        await tx.return.update({
          where: { id: adj.returnId },
          data: { financeReviewedAt: null, financeReviewedBy: null },
        });
      }
      await tx.walletAdjustmentHistory.create({
        data: {
          adjustmentId: adj.id,
          customerId: adj.customerId,
          action: 'REJECTED',
          fromStatus: adj.status,
          toStatus: 'REJECTED',
          actorId: args.rejectedByAdminId,
          reason: args.rejectionReason,
          amountInPaise: adj.amountInPaise,
        },
      });
      return updated;
    });

    await this.writeAudit(args.rejectedByAdminId, WALLET_ADJUSTMENT_EVENTS.REJECTED, result, adj, result, args.rejectionReason);
    // Phase 162 (#5/#13) — the rejected event carries returnId so the returns/
    // refund module can re-route a TIME_BARRED refund to the original payment
    // path (a deliberate, non-auto decision to avoid double-refund); the
    // financeReviewedAt clear above also resurfaces it in the timebar queue.
    this.emit(WALLET_ADJUSTMENT_EVENTS.REJECTED, result);
    return result;
  }

  /**
   * Phase 162 (Wallet Adjustments audit #12) — reverse a POSTED adjustment by
   * posting a compensating INVERSE ledger entry and flipping status → REVERSED.
   * The original wallet_transaction stays (immutable ledger); the reversal is a
   * new opposite entry, so the trail is auditor-clean. Idempotent on REVERSED.
   */
  async reverse(args: {
    adjustmentId: string;
    reversedByAdminId: string;
    reason: string;
  }): Promise<WalletAdjustment> {
    const reason = (args.reason ?? '').trim();
    if (reason.length < 8) {
      throw new Error('A reason (min 8 chars) is required to reverse a wallet adjustment.');
    }
    const adj = await this.prisma.walletAdjustment.findUnique({
      where: { id: args.adjustmentId },
    });
    if (!adj) throw new WalletAdjustmentNotFoundError(args.adjustmentId);
    if (adj.status === 'REVERSED') return adj; // idempotent
    if (adj.status !== 'APPROVED' || !adj.walletTransactionId) {
      throw new WalletAdjustmentNotApprovableError(args.adjustmentId, adj.status);
    }

    // Post the inverse: a credit adjustment is reversed by a debit, a debit by
    // a credit. Reuse the same idempotent wallet facade (a distinct reference
    // id `${adj.id}:reverse` so it posts exactly once).
    const reversingAmount = -adj.amountInPaise; // flip the sign
    const safe = this.toSafeNumber.bind(this);
    let reversingTxId: string;
    if (reversingAmount > 0n) {
      const r = await this.wallet.creditAdjustment({
        userId: adj.customerId,
        amountInPaise: safe(reversingAmount, adj.id),
        adjustmentId: `${adj.id}:reverse`,
        description: `Reversal of adjustment ${adj.id} — ${formatRupees(reversingAmount)}`,
        internalNotes: reason,
        createdByAdminId: args.reversedByAdminId,
        bypassBlock: false,
      });
      reversingTxId = r.transaction.id;
    } else {
      const r = await this.wallet.debitAdjustment({
        userId: adj.customerId,
        amountInPaise: safe(-reversingAmount, adj.id),
        adjustmentId: `${adj.id}:reverse`,
        description: `Reversal of adjustment ${adj.id} — ${formatRupees(-reversingAmount)}`,
        internalNotes: reason,
        createdByAdminId: args.reversedByAdminId,
      });
      reversingTxId = r.transaction.id;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.walletAdjustment.update({
        where: { id: adj.id },
        data: {
          status: 'REVERSED',
          reversedByAdminId: args.reversedByAdminId,
          reversedAt: new Date(),
          reverseReason: reason,
          reversingTransactionId: reversingTxId,
        },
      });
      await tx.walletAdjustmentHistory.create({
        data: {
          adjustmentId: adj.id,
          customerId: adj.customerId,
          action: 'REVERSED',
          fromStatus: 'APPROVED',
          toStatus: 'REVERSED',
          actorId: args.reversedByAdminId,
          reason,
          amountInPaise: reversingAmount,
        },
      });
      return row;
    });

    await this.writeAudit(args.reversedByAdminId, WALLET_ADJUSTMENT_EVENTS.REVERSED, updated, adj, updated, reason);
    this.emit(WALLET_ADJUSTMENT_EVENTS.REVERSED, updated);
    void this.notifyCustomer(updated, 'reversed');
    this.logger.log(`WalletAdjustment ${adj.id} REVERSED by ${args.reversedByAdminId} (tx ${reversingTxId})`);
    return updated;
  }

  // ── Internals ────────────────────────────────────────────────────

  private async createAdjustment(args: {
    customerId: string;
    kind: WalletAdjustmentKind;
    amountInPaise: bigint;
    reason: string;
    subOrderId: string | null;
    returnId: string | null;
    sourceTaxDocumentId: string | null;
    wouldHaveBeenTaxableInPaise: bigint | null;
    wouldHaveBeenCgstInPaise: bigint | null;
    wouldHaveBeenSgstInPaise: bigint | null;
    wouldHaveBeenIgstInPaise: bigint | null;
    wouldHaveBeenTotalTaxInPaise: bigint | null;
    idempotencyKey: string;
    requestedByAdminId: string | null;
    forceDualApproval?: boolean;
  }): Promise<WalletAdjustment> {
    // Idempotency — return existing row on retry.
    const existing = await this.prisma.walletAdjustment.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });
    if (existing) return existing;

    const threshold = this.dualApprovalThreshold();
    const absAmount =
      args.amountInPaise < 0n ? -args.amountInPaise : args.amountInPaise;
    const requiresDualApproval =
      args.forceDualApproval === true || absAmount >= threshold;

    const created = await this.prisma.walletAdjustment.create({
      data: {
        customerId: args.customerId,
        kind: args.kind,
        amountInPaise: args.amountInPaise,
        reason: args.reason,
        subOrderId: args.subOrderId,
        returnId: args.returnId,
        sourceTaxDocumentId: args.sourceTaxDocumentId,
        wouldHaveBeenTaxableInPaise: args.wouldHaveBeenTaxableInPaise,
        wouldHaveBeenCgstInPaise: args.wouldHaveBeenCgstInPaise,
        wouldHaveBeenSgstInPaise: args.wouldHaveBeenSgstInPaise,
        wouldHaveBeenIgstInPaise: args.wouldHaveBeenIgstInPaise,
        wouldHaveBeenTotalTaxInPaise: args.wouldHaveBeenTotalTaxInPaise,
        idempotencyKey: args.idempotencyKey,
        requestedByAdminId: args.requestedByAdminId,
        requiresDualApproval,
      },
    });

    // Phase 162 (#1/#5/#11) — history + audit + event on request.
    await this.recordHistory(created, 'REQUESTED', null, 'PENDING_APPROVAL', args.requestedByAdminId, created.reason);
    await this.writeAudit(args.requestedByAdminId, WALLET_ADJUSTMENT_EVENTS.REQUESTED, created, null, created);
    this.emit(WALLET_ADJUSTMENT_EVENTS.REQUESTED, created);

    // Auto-approve gate: only when (below threshold) + (flag on) +
    // (not force-dual-approval). MANUAL_DEBIT always force-dual.
    // Phase 162 (#4) — auto-approve posts under the SYSTEM_AUTO_APPROVE
    // sentinel, never null and never the requester, so the audit trail shows
    // an explicit non-human approver.
    if (
      !requiresDualApproval &&
      this.autoApproveBelowThreshold() &&
      args.kind !== 'MANUAL_DEBIT'
    ) {
      return this.postAdjustment(created, SYSTEM_AUTO_APPROVE);
    }

    this.logger.log(
      `WalletAdjustment ${created.id} (${args.kind}, ` +
        `${args.amountInPaise.toString()} paise) → PENDING_APPROVAL` +
        (requiresDualApproval ? ' [dual-approval required]' : ''),
    );
    return created;
  }

  private async postAdjustment(
    adj: WalletAdjustment,
    approvedByAdminId: string | null,
  ): Promise<WalletAdjustment> {
    const isCredit = adj.amountInPaise > 0n;
    const isDebit = adj.amountInPaise < 0n;
    if (!isCredit && !isDebit) {
      throw new Error(
        `WalletAdjustment ${adj.id} has zero amount; refusing to post.`,
      );
    }

    // Post to wallet ledger. Idempotency at the wallet layer means a
    // re-tried post returns the existing transaction.
    //
    // BigInt → Number coercion: `WalletPublicFacade.{credit,debit}Adjustment`
    // currently accept `number`. We assert the BigInt fits in
    // Number.MAX_SAFE_INTEGER (2^53 − 1 paise ≈ ₹90 trillion) before
    // coercing. A single wallet adjustment that breaches this bar is
    // a bug upstream — we throw rather than silently truncate. The
    // long-term fix is widening the wallet facade to accept BigInt
    // directly; until then this guard catches the loss-of-precision
    // edge case at the boundary.
    // Phase 162 (#3) — boundary guard now audits + logs before throwing
    // (was a silent throw); see toSafeNumber.
    const safe = (v: bigint): number => this.toSafeNumber(v, adj.id);

    // Phase 162 (#10) — bypassBlock=true overrides any active wallet block for
    // TIME_BARRED refunds (platform owes the money). The block model is a
    // single untyped flag (no KYC-specific type to honor selectively); the
    // wallet layer already writes a WALLET_BLOCK_BYPASSED audit row when a
    // block is actually consumed. We surface the intent at this layer too.
    const bypassBlock = adj.kind === 'TIME_BARRED_CREDIT_NOTE';
    if (bypassBlock) {
      this.logger.warn(
        `WalletAdjustment ${adj.id} posting with bypassBlock=true (TIME_BARRED) — ` +
          `any active wallet block is overridden; wallet layer audits if consumed.`,
      );
    }

    let txId: string;
    if (isCredit) {
      const result = await this.wallet.creditAdjustment({
        userId: adj.customerId,
        amountInPaise: safe(adj.amountInPaise),
        adjustmentId: adj.id,
        description: this.buildLedgerDescription(adj),
        internalNotes: adj.reason,
        createdByAdminId: approvedByAdminId ?? undefined,
        bypassBlock,
      });
      txId = result.transaction.id;
    } else {
      const result = await this.wallet.debitAdjustment({
        userId: adj.customerId,
        amountInPaise: safe(-adj.amountInPaise),
        adjustmentId: adj.id,
        description: this.buildLedgerDescription(adj),
        internalNotes: adj.reason,
        createdByAdminId: approvedByAdminId ?? undefined,
      });
      txId = result.transaction.id;
    }

    const updated = await this.prisma.walletAdjustment.update({
      where: { id: adj.id },
      data: {
        status: 'APPROVED',
        approvedByAdminId: approvedByAdminId,
        approvedAt: new Date(),
        walletTransactionId: txId,
      },
    });
    this.logger.log(
      `WalletAdjustment ${updated.id} APPROVED + posted as ` +
        `wallet_transaction ${txId}`,
    );

    // Phase 162 (#1/#5/#6/#11) — history + audit + event + customer notify.
    const action = approvedByAdminId === SYSTEM_AUTO_APPROVE ? 'AUTO_APPROVED' : 'APPROVED';
    await this.recordHistory(updated, action, adj.status, 'APPROVED', approvedByAdminId, adj.reason);
    await this.writeAudit(approvedByAdminId, WALLET_ADJUSTMENT_EVENTS.APPROVED, updated, adj, updated, adj.reason);
    this.emit(WALLET_ADJUSTMENT_EVENTS.APPROVED, updated);
    void this.notifyCustomer(updated, 'approved');

    // Phase 109 (2026-05-25) — complete the return lifecycle. For a time-barred
    // refund the wallet adjustment IS the customer refund, so once it posts we
    // flip the linked Return to REFUNDED. submitQcDecision deliberately left it
    // in QC_APPROVED (it skipped the gateway/instant refund to avoid a
    // double-pay), so without this the return would be stuck even though the
    // customer has now been paid. Best-effort: a failure here is logged loudly
    // (money already moved) rather than rolling back the approval.
    if (adj.kind === 'TIME_BARRED_CREDIT_NOTE' && adj.returnId) {
      await this.prisma.return
        .update({
          where: { id: adj.returnId },
          data: {
            status: 'REFUNDED',
            refundMethod: 'WALLET',
            refundReference: `adjustment:${adj.id}`,
            refundProcessedAt: new Date(),
            refundInitiatedBy: 'SYSTEM',
            refundInitiatedAt: new Date(),
            refundFailureReason: null,
            financeReviewedBy: approvedByAdminId,
            financeReviewedAt: new Date(),
          },
        })
        .catch((err) => {
          this.logger.error(
            `WalletAdjustment ${adj.id} posted, but failed to flip return ` +
              `${adj.returnId} to REFUNDED: ${(err as Error).message} — ` +
              `return is stuck in QC_APPROVED; ops must reconcile.`,
          );
        });

      // Phase 109 (2026-05-25) — book the absorbed GST (the platform can no
      // longer reclaim it via a credit note) as a PlatformExpense so GSTR
      // reconciliation can trace it. Only when there was GST to absorb (null
      // for legacy / no-invoice returns). The sourceId is namespaced so it
      // doesn't collide with a liability-ledger PlatformExpense(RETURN,
      // returnId) written at QC time.
      const absorbedGstInPaise = adj.wouldHaveBeenTotalTaxInPaise;
      if (absorbedGstInPaise && absorbedGstInPaise > 0n) {
        await this.prisma.platformExpense
          .create({
            data: {
              sourceType: 'RETURN',
              sourceId: `gst-timebar:${adj.returnId}`,
              expenseType: 'ABSORBED_GST',
              amountInPaise: absorbedGstInPaise,
              reason: `Section 34 time-barred return ${adj.returnId} — platform absorbed GST (no credit note issued).`,
            },
          })
          .catch((expErr) => {
            this.logger.error(
              `Failed to record absorbed-GST PlatformExpense for adjustment ${adj.id}: ${(expErr as Error).message}`,
            );
          });
      }
    }

    return updated;
  }

  private buildLedgerDescription(adj: WalletAdjustment): string {
    // Phase 162 (#14) — BigInt-native paise→rupees (no Number coercion).
    switch (adj.kind) {
      case 'TIME_BARRED_CREDIT_NOTE':
        return `Refund (GST credit note time-barred) — ${formatRupees(adj.amountInPaise)}`;
      case 'GOODWILL':
        return `Goodwill credit — ${formatRupees(adj.amountInPaise)}`;
      case 'MANUAL_DEBIT':
        return `Manual debit — ${formatRupees(-adj.amountInPaise)}`;
      default:
        return `Wallet adjustment — ${formatRupees(adj.amountInPaise)}`;
    }
  }

  // ── audit / history / event / notify helpers (Phase 162) ──────────

  /** #3 — boundary guard: audit + log the (impossible-but-defensive) overflow
   *  before throwing, instead of the prior silent throw. */
  private toSafeNumber(v: bigint, adjustmentId: string): number {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
      this.logger.error(
        `WalletAdjustment ${adjustmentId} amount ${v} exceeds MAX_SAFE_INTEGER paise (~₹90T) — refusing to coerce.`,
      );
      void this.audit
        .writeAuditLog({
          action: 'wallet.adjustment.amount_overflow',
          module: 'tax',
          resource: 'wallet_adjustment',
          resourceId: adjustmentId,
          newValue: { amountInPaise: v.toString(), maxSafeInteger: Number.MAX_SAFE_INTEGER },
        })
        .catch(() => undefined);
      throw new Error(
        `WalletAdjustment ${adjustmentId} amount ${v} exceeds Number.MAX_SAFE_INTEGER paise (~₹90T) — wallet facade cannot accept it without precision loss.`,
      );
    }
    return Number(v);
  }

  private async recordHistory(
    adj: WalletAdjustment,
    action: string,
    fromStatus: WalletAdjustmentStatus | null,
    toStatus: WalletAdjustmentStatus,
    actorId: string | null | undefined,
    reason: string | null,
  ): Promise<void> {
    await this.prisma.walletAdjustmentHistory
      .create({
        data: {
          adjustmentId: adj.id,
          customerId: adj.customerId,
          action,
          fromStatus,
          toStatus,
          actorId: actorId ?? null,
          reason,
          amountInPaise: adj.amountInPaise,
        },
      })
      .catch((err: unknown) =>
        this.logger.error(
          `WalletAdjustment history write failed for ${adj.id}: ${(err as Error).message}`,
        ),
      );
  }

  private async writeAudit(
    actorId: string | null | undefined,
    action: string,
    adj: WalletAdjustment,
    before: WalletAdjustment | null,
    after: WalletAdjustment | null,
    reason?: string | null,
  ): Promise<void> {
    await this.audit
      .writeAuditLog({
        actorId: actorId ?? undefined,
        action,
        module: 'tax',
        resource: 'wallet_adjustment',
        resourceId: adj.id,
        oldValue: before ? snapshot(before) : undefined,
        newValue: after ? snapshot(after) : undefined,
        metadata: reason ? { reason } : undefined,
      })
      .catch((err) =>
        this.logger.error(
          `WalletAdjustment audit-log write failed for ${adj.id}: ${(err as Error).message}`,
        ),
      );
  }

  private emit(eventName: string, adj: WalletAdjustment): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName,
        aggregate: 'WalletAdjustment',
        aggregateId: adj.id,
        occurredAt: new Date(),
        payload: {
          adjustmentId: adj.id,
          customerId: adj.customerId,
          kind: adj.kind,
          status: adj.status,
          amountInPaise: adj.amountInPaise.toString(),
          returnId: adj.returnId,
        },
      })
      .catch(() => undefined);
  }

  private async notifyCustomer(
    adj: WalletAdjustment,
    change: 'approved' | 'reversed',
  ): Promise<void> {
    if (!this.notifications) return;
    await this.notifications
      .sendNotification({
        recipientId: adj.customerId,
        channel: 'email',
        templateKey:
          change === 'approved'
            ? 'wallet.adjustment.approved'
            : 'wallet.adjustment.reversed',
        data: {
          amount: formatRupees(adj.amountInPaise < 0n ? -adj.amountInPaise : adj.amountInPaise),
          reason: adj.reason,
        },
      })
      .catch(() => undefined);
  }
}

/** Phase 162 (#14) — BigInt-safe paise → "₹X.YY" (no float). */
function formatRupees(paise: bigint): string {
  const neg = paise < 0n;
  const abs = neg ? -paise : paise;
  const rupees = abs / 100n;
  const frac = abs % 100n;
  return `${neg ? '-' : ''}₹${rupees.toString()}.${frac.toString().padStart(2, '0')}`;
}

function snapshot(adj: WalletAdjustment): Record<string, unknown> {
  return {
    status: adj.status,
    kind: adj.kind,
    amountInPaise: adj.amountInPaise != null ? adj.amountInPaise.toString() : null,
    requiresDualApproval: adj.requiresDualApproval,
    requestedByAdminId: adj.requestedByAdminId,
    firstApprovedByAdminId: adj.firstApprovedByAdminId,
    approvedByAdminId: adj.approvedByAdminId,
    rejectedByAdminId: adj.rejectedByAdminId,
    reversedByAdminId: adj.reversedByAdminId,
    walletTransactionId: adj.walletTransactionId,
  };
}
