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

import { Injectable, Logger } from '@nestjs/common';
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
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.walletAdjustment.update({
        where: { id: args.adjustmentId },
        data: {
          status: 'REJECTED',
          rejectedByAdminId: args.rejectedByAdminId,
          rejectedAt,
          rejectionReason: args.rejectionReason,
          idempotencyKey: `${adj.idempotencyKey}:rejected-${rejectedAt.getTime()}`,
        },
      });

      if (adj.kind === 'TIME_BARRED_CREDIT_NOTE' && adj.returnId) {
        await tx.return.update({
          where: { id: adj.returnId },
          data: { financeReviewedAt: null, financeReviewedBy: null },
        });
      }

      return updated;
    });
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

    // Auto-approve gate: only when (below threshold) + (flag on) +
    // (not force-dual-approval). MANUAL_DEBIT always force-dual.
    if (
      !requiresDualApproval &&
      this.autoApproveBelowThreshold() &&
      args.kind !== 'MANUAL_DEBIT'
    ) {
      return this.postAdjustment(created, /* approvedByAdminId */ null);
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
    const safe = (v: bigint): number => {
      if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(
          `WalletAdjustment ${adj.id} amount ${v} exceeds Number.MAX_SAFE_INTEGER paise (~₹90T) — wallet facade cannot accept it without precision loss.`,
        );
      }
      return Number(v);
    };

    let txId: string;
    if (isCredit) {
      const result = await this.wallet.creditAdjustment({
        userId: adj.customerId,
        amountInPaise: safe(adj.amountInPaise),
        adjustmentId: adj.id,
        description: this.buildLedgerDescription(adj),
        internalNotes: adj.reason,
        createdByAdminId: approvedByAdminId ?? undefined,
        // TIME_BARRED refunds must land even if the customer's wallet
        // is blocked — the platform owes the money.
        bypassBlock: adj.kind === 'TIME_BARRED_CREDIT_NOTE',
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
    switch (adj.kind) {
      case 'TIME_BARRED_CREDIT_NOTE':
        return `Refund (GST credit note time-barred) — ₹${(Number(adj.amountInPaise) / 100).toFixed(2)}`;
      case 'GOODWILL':
        return `Goodwill credit — ₹${(Number(adj.amountInPaise) / 100).toFixed(2)}`;
      case 'MANUAL_DEBIT':
        return `Manual debit — ₹${(Number(-adj.amountInPaise) / 100).toFixed(2)}`;
      default:
        return `Wallet adjustment — ₹${(Number(adj.amountInPaise) / 100).toFixed(2)}`;
    }
  }
}
