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
    return this.env.getBoolean(
      'WALLET_ADJUSTMENT_AUTO_APPROVE_BELOW_THRESHOLD' as any,
      true,
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

  /** Approve a pending adjustment + post to the wallet ledger.
   *  Idempotent on adjustmentId. */
  async approve(args: {
    adjustmentId: string;
    approvedByAdminId: string;
  }): Promise<WalletAdjustment> {
    const adj = await this.prisma.walletAdjustment.findUnique({
      where: { id: args.adjustmentId },
    });
    if (!adj) throw new WalletAdjustmentNotFoundError(args.adjustmentId);

    if (adj.status === 'APPROVED') return adj; // idempotent
    if (adj.status !== 'PENDING_APPROVAL') {
      throw new WalletAdjustmentNotApprovableError(args.adjustmentId, adj.status);
    }

    return this.postAdjustment(adj, args.approvedByAdminId);
  }

  /** Reject a pending adjustment. No money moves. */
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
    if (adj.status !== 'PENDING_APPROVAL') {
      throw new Error(
        `WalletAdjustment ${args.adjustmentId} cannot be rejected from status ${adj.status}`,
      );
    }

    return this.prisma.walletAdjustment.update({
      where: { id: args.adjustmentId },
      data: {
        status: 'REJECTED',
        rejectedByAdminId: args.rejectedByAdminId,
        rejectedAt: new Date(),
        rejectionReason: args.rejectionReason,
      },
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
    let txId: string;
    if (isCredit) {
      const result = await this.wallet.creditAdjustment({
        userId: adj.customerId,
        amountInPaise: Number(adj.amountInPaise),
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
        amountInPaise: Number(-adj.amountInPaise),
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
