// Phase 11 of the GST/tax/invoice system — CreditNoteService.
//
// Issues a Section 34 CREDIT_NOTE against an existing TAX_INVOICE /
// INVOICE_CUM_BILL_OF_SUPPLY when a return has been QC-approved and
// the resulting refund includes a taxable-value reversal.
//
// Pipeline:
//   1. Load return + approved items + linked sub-order.
//   2. Find the source TaxDocument for that sub-order (must be
//      invoice-like: TAX_INVOICE / INVOICE_CUM_BILL_OF_SUPPLY).
//   3. Check Section 34 time-bar — if past 30 Sept of next FY,
//      throw `Section34TimeBarredError`. Caller decides whether to
//      issue a wallet adjustment instead (Phase 13).
//   4. For each approved ReturnItem: load OrderItemTaxSnapshot,
//      compute proportional reversal via `calculateGstReversal`.
//   5. Under a per-return advisory lock (Phase 164 #1/#6): read prior
//      CNs, compute the DELTA, allocate a number, persist the CN + lines.
//   6. Transition source invoice to PARTIALLY_REVERSED / FULLY_REVERSED.
//   7. Audit (#4), publish a domain event (#19), notify the customer.
//
// Idempotency (Phase 30 — multi-cycle): re-running for the same return
// computes the DELTA between the cumulative reversal already credited
// across prior credit notes and the reversal the current QC-approved
// state implies. The multi-cycle design intentionally issues MULTIPLE
// credit notes per return (staged QC), so prior-CN discovery keys on the
// structured `returnId` column (Phase 164 #2/#3 — replacing the brittle
// `reason CONTAINS returnNumber` text match that an admin reason override
// silently defeated). The whole read-compute-write runs under a
// transaction-scoped advisory lock keyed on the return, so two concurrent
// callers (QC trigger + admin override, or two API replicas) can't both
// insert a CN for the same delta — the second sees the first's CN and
// returns it idempotently (Phase 164 #1/#6).
//
// See:
//   - docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md
//   - docs/tax/CA.md §6.2 Section 34

import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EventBusService } from '../../../../bootstrap/events/event-bus.service';
import { DocumentSequenceService } from './document-sequence.service';
import { TaxDocumentService } from './tax-document.service';
import { TaxNotificationService } from './tax-notification.service';
import { TaxModeService } from './tax-mode.service';
import { AuditPublicFacade } from '../../../audit/application/facades/audit-public.facade';
import { paiseToInvoiceWords } from '../../domain/amount-in-words';
import { computeInvoiceRoundOff } from '../../domain/round-off';
import {
  isWithinSection34Window,
  section34CutoffFor,
} from '../../domain/credit-note-time-bar';
import { CREDIT_NOTE_EVENTS } from '../../domain/credit-note-events';
import { calculateGstReversal } from '../../../discounts/domain/tax/calculate-gst';
import {
  Prisma,
  type TaxDocumentStatus,
} from '@prisma/client';

/**
 * Phase 164 (#17) — system actor sentinel for the auto / cron path. The
 * QC-completion trigger passes the QC-completing admin's id; the time-bar
 * retry cron and any other unattended path passes this constant so the
 * FSM-transition + audit rows are never attributed to `null`.
 */
export const SYSTEM_CREDIT_NOTE_ACTOR = 'SYSTEM_TAX_CREDIT_NOTE';

export class Section34TimeBarredError extends Error {
  constructor(
    public readonly originalInvoiceNumber: string,
    public readonly originalInvoiceDate: Date,
    public readonly cutoff: Date,
  ) {
    super(
      `Credit note for invoice ${originalInvoiceNumber} is time-barred. ` +
        `Section 34 cutoff was ${cutoff.toISOString()}; ` +
        `original invoice date ${originalInvoiceDate.toISOString()}.`,
    );
    this.name = 'Section34TimeBarredError';
  }
}

/**
 * Thrown when a return's sub-order has no source tax invoice to credit against
 * (legacy / unbilled order). The caller routes the refund through the wallet
 * adjustment (which has a LEGACY_RECEIPT fallback) and flags the return
 * REQUIRES_FINANCE_REVIEW, rather than failing the QC decision or paying twice.
 */
export class SourceInvoiceNotFoundError extends Error {
  constructor(public readonly subOrderId: string) {
    super(
      `No active source tax invoice found for sub-order ${subOrderId}. ` +
        `Run TaxDocumentService.generateForSubOrder before issuing a credit note.`,
    );
    this.name = 'SourceInvoiceNotFoundError';
  }
}

/**
 * Phase 164 (#14) — thrown in STRICT mode when one or more QC-approved
 * lines lack an OrderItemTaxSnapshot, so the CN would silently under-credit.
 * In OFF/AUDIT the generator proceeds with partial coverage (flagged on the
 * row); in STRICT the missing snapshot is a hard stop for finance to resolve.
 */
export class CreditNoteIncompleteSnapshotError extends Error {
  constructor(
    public readonly returnNumber: string,
    public readonly skippedLineCount: number,
  ) {
    super(
      `Return ${returnNumber}: ${skippedLineCount} QC-approved line(s) have no ` +
        `OrderItemTaxSnapshot — cannot compute a complete GST reversal in STRICT mode.`,
    );
    this.name = 'CreditNoteIncompleteSnapshotError';
  }
}

export interface GenerateCreditNoteForReturnOptions {
  /** Override "now" — useful for testing the time-bar window. */
  now?: Date;
  actorId?: string | null;
  /** Free-text reason for credit-note `reason` column. Falls back to
   *  the Return's reasonCategory when omitted. */
  reason?: string;
}

export interface GenerateCreditNoteResult {
  creditNote: {
    id: string;
    documentNumber: string;
    documentTotalInPaise: bigint;
    taxableReversalInPaise: bigint;
    totalTaxReversalInPaise: bigint;
  };
  sourceInvoice: {
    id: string;
    documentNumber: string;
    statusAfter: TaxDocumentStatus;
  };
  isNew: boolean;
}

interface LineReversal {
  orderItemId: string;
  sourceLineId: string;
  sourceSnapshotId: string;
  productId: string | null;
  variantId: string | null;
  productName: string;
  hsnOrSacCode: string | null;
  uqcCode: string | null;
  gstRateBps: number;
  returnedQuantity: number;
  grossReversal: bigint;
  discountReversal: bigint;
  taxableReversal: bigint;
  cgstReversal: bigint;
  sgstReversal: bigint;
  igstReversal: bigint;
  cessReversal: bigint;
  totalTaxReversal: bigint;
  totalCreditLine: bigint;
}

@Injectable()
export class CreditNoteService {
  private readonly logger = new Logger(CreditNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docSequence: DocumentSequenceService,
    private readonly taxDocument: TaxDocumentService,
    // Phase 31 — fires customerCreditNoteIssued always and
    // customerB2bItcReversalRequired when the source invoice was B2B.
    private readonly notifications: TaxNotificationService,
    // Phase 164 (#4) — compliance audit trail on every CN issuance.
    private readonly audit: AuditPublicFacade,
    // Phase 164 (KEY: GST mode) — the generator now consults the engine
    // mode for data-integrity strictness (missing-snapshot handling, #14).
    private readonly taxMode: TaxModeService,
    // Phase 164 (#19) — durable lifecycle event (best-effort; @Optional so
    // unit tests can construct the service without the full DI graph).
    @Optional() private readonly eventBus?: EventBusService,
  ) {}

  /**
   * Generate (or return existing) credit note for a QC-approved return.
   * Throws `Section34TimeBarredError` if the cutoff has lapsed.
   */
  async generateForReturn(
    returnId: string,
    options: GenerateCreditNoteForReturnOptions = {},
  ): Promise<GenerateCreditNoteResult> {
    const now = options.now ?? new Date();
    const actorId = options.actorId ?? SYSTEM_CREDIT_NOTE_ACTOR;

    // 1. Load return + items.
    const returnRow = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: { items: true },
    });
    if (!returnRow) throw new Error(`Return ${returnId} not found`);

    // 2. Find approved items (qcQuantityApproved > 0).
    const approvedItems = returnRow.items.filter(
      (it) => (it.qcQuantityApproved ?? 0) > 0,
    );
    if (approvedItems.length === 0) {
      throw new Error(
        `Return ${returnRow.returnNumber}: no QC-approved items; nothing to credit.`,
      );
    }

    // 3. Find source invoice for this sub-order.
    const sourceInvoice = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId: returnRow.subOrderId,
        documentType: { in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'] },
        status: { notIn: ['VOIDED_DRAFT', 'SUPERSEDED'] },
      },
      orderBy: { generatedAt: 'desc' },
    });
    if (!sourceInvoice) {
      throw new SourceInvoiceNotFoundError(returnRow.subOrderId);
    }
    if (!sourceInvoice.generatedAt) {
      throw new Error(`Source invoice ${sourceInvoice.documentNumber} has no generatedAt date.`);
    }

    // 4. Section 34 time-bar check.
    if (!isWithinSection34Window(sourceInvoice.generatedAt, now)) {
      throw new Section34TimeBarredError(
        sourceInvoice.documentNumber,
        sourceInvoice.generatedAt,
        section34CutoffFor(sourceInvoice.generatedAt),
      );
    }

    // 5. Load snapshots + source lines (immutable once issued — safe to
    //    read outside the lock).
    const orderItemIds = approvedItems.map((it) => it.orderItemId);
    const snapshots = await this.prisma.orderItemTaxSnapshot.findMany({
      where: { orderItemId: { in: orderItemIds } },
    });
    const snapshotByOrderItemId = new Map(snapshots.map((s) => [s.orderItemId!, s]));
    const sourceLines = await this.prisma.taxDocumentLine.findMany({
      where: { documentId: sourceInvoice.id },
    });
    const sourceLineBySnapshotId = new Map(
      sourceLines.filter((l) => l.sourceSnapshotId).map((l) => [l.sourceSnapshotId!, l]),
    );

    // 6. Compute the CUMULATIVE reversal implied by the current QC state,
    //    per approved item. Skip (and count) items whose snapshot or
    //    source line is missing — legacy orders with no GST trail.
    interface Candidate {
      snapshotId: string;
      sourceLine: (typeof sourceLines)[number];
      productName: string;
      hsnOrSacCode: string | null;
      uqcCode: string | null;
      gstRateBps: number;
      productId: string | null;
      variantId: string | null;
      orderItemId: string;
      returnedQty: number;
      cumulative: ReturnType<typeof calculateGstReversal>;
    }
    const candidates: Candidate[] = [];
    let skippedLineCount = 0;
    for (const item of approvedItems) {
      const snapshot = snapshotByOrderItemId.get(item.orderItemId);
      if (!snapshot) {
        skippedLineCount++;
        this.logger.warn(
          `Return ${returnRow.returnNumber}: no OrderItemTaxSnapshot for orderItem ${item.orderItemId} — skipping (legacy order; no GST reversal possible)`,
        );
        continue;
      }
      const sourceLine = sourceLineBySnapshotId.get(snapshot.id);
      if (!sourceLine) {
        skippedLineCount++;
        this.logger.warn(
          `Return ${returnRow.returnNumber}: no TaxDocumentLine for snapshot ${snapshot.id} — skipping`,
        );
        continue;
      }
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { quantity: true },
      });
      const purchasedQty = orderItem?.quantity ?? 1;
      const returnedQty = item.qcQuantityApproved ?? 0;
      if (returnedQty <= 0 || returnedQty > purchasedQty) {
        skippedLineCount++;
        this.logger.warn(
          `Return ${returnRow.returnNumber}: invalid returnedQty=${returnedQty} vs purchasedQty=${purchasedQty} for item ${item.orderItemId}`,
        );
        continue;
      }
      const cumulative = calculateGstReversal({
        originalGrossInPaise: snapshot.grossLineAmountInPaise,
        originalDiscountInPaise: snapshot.discountAmountInPaise,
        originalCgstInPaise: snapshot.cgstAmountInPaise,
        originalSgstInPaise: snapshot.sgstAmountInPaise,
        originalIgstInPaise: snapshot.igstAmountInPaise,
        // Phase 164 (#8) — cess now reverses proportionally instead of
        // being dropped to 0n.
        originalCessInPaise: snapshot.cessAmountInPaise,
        purchasedQuantity: purchasedQty,
        returnedQuantity: returnedQty,
      });
      candidates.push({
        snapshotId: snapshot.id,
        sourceLine,
        productName: snapshot.description ?? sourceLine.productName,
        hsnOrSacCode: snapshot.hsnCode,
        uqcCode: snapshot.uqcCode,
        gstRateBps: snapshot.gstRateBps,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        orderItemId: item.orderItemId,
        returnedQty,
        cumulative,
      });
    }

    // Phase 164 (#14 + KEY mode) — partial coverage is a data-integrity
    // problem. The generator now consults the tax engine mode: STRICT is a
    // hard stop (finance must backfill the snapshot or route to wallet);
    // AUDIT records the violation but proceeds with partial coverage
    // (flagged on the CN via partialCoverageLineCount); OFF is permissive.
    if (skippedLineCount > 0) {
      const mode = await this.taxMode.getMode();
      if (mode === 'STRICT') {
        throw new CreditNoteIncompleteSnapshotError(returnRow.returnNumber, skippedLineCount);
      }
      await this.taxMode
        .report({
          code: 'cn.incomplete_snapshot',
          message:
            `Return ${returnRow.returnNumber}: ${skippedLineCount} QC-approved line(s) ` +
            `lack an OrderItemTaxSnapshot — credit note covers only the snapshotted lines.`,
          context: { returnId, skippedLineCount },
        })
        .catch(() => undefined);
    }

    // 7. Critical section — advisory-locked read-compute-write. Closes the
    //    duplicate-CN race (#1) + the prior-CN TOCTOU (#6): two concurrent
    //    callers for the same return serialise here, so the second sees the
    //    first's committed CN and computes a zero delta.
    const txResult = await this.prisma.$transaction(async (tx) => {
      // pg_advisory_xact_lock auto-releases at transaction end. Keyed on the
      // return id so different returns don't contend.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${returnId})::bigint)`;

      // Prior CNs for this return. Primary key is the structured returnId
      // (#2/#3) — matched across ALL source invoices, not just the current
      // one, so a re-invoiced sub-order (old invoice SUPERSEDED) can't be
      // double-credited (#7: prior CNs against the old invoice are still
      // subtracted, because the delta aggregates per sourceSnapshotId). The
      // reason-CONTAINS branch is the legacy fallback for pre-migration CNs
      // whose returnId wasn't backfilled (scoped to this invoice + number).
      const priorCreditNotes = await tx.taxDocument.findMany({
        where: {
          documentType: 'CREDIT_NOTE',
          status: { notIn: ['VOIDED_DRAFT'] },
          OR: [
            { returnId },
            {
              returnId: null,
              originalDocumentId: sourceInvoice.id,
              reason: { contains: returnRow.returnNumber },
            },
          ],
        },
        orderBy: { generatedAt: 'desc' },
      });

      const priorBySnapshot = await this.aggregatePriorReversals(tx, priorCreditNotes.map((c) => c.id));

      // Per-line DELTA.
      const reversals: LineReversal[] = [];
      for (const c of candidates) {
        const prior = priorBySnapshot.get(c.snapshotId);
        const deltaQty = c.returnedQty - (prior?.quantity ?? 0);
        if (deltaQty <= 0) continue;
        const deltaGross = c.cumulative.grossReturnedInPaise - (prior?.gross ?? 0n);
        const deltaDiscount = c.cumulative.discountReversalInPaise - (prior?.discount ?? 0n);
        const deltaTaxable = c.cumulative.taxableReversalInPaise - (prior?.taxable ?? 0n);
        const deltaCgst = c.cumulative.cgstReversalInPaise - (prior?.cgst ?? 0n);
        const deltaSgst = c.cumulative.sgstReversalInPaise - (prior?.sgst ?? 0n);
        const deltaIgst = c.cumulative.igstReversalInPaise - (prior?.igst ?? 0n);
        const deltaCess = c.cumulative.cessReversalInPaise - (prior?.cess ?? 0n);
        const deltaTotalTax = c.cumulative.totalTaxReversalInPaise - (prior?.totalTax ?? 0n);
        const deltaCredit = c.cumulative.totalCreditNoteInPaise - (prior?.creditTotal ?? 0n);
        if (
          deltaGross === 0n &&
          deltaTaxable === 0n &&
          deltaTotalTax === 0n &&
          deltaCess === 0n &&
          deltaCredit === 0n
        ) {
          continue;
        }
        reversals.push({
          orderItemId: c.orderItemId,
          sourceLineId: c.sourceLine.id,
          sourceSnapshotId: c.snapshotId,
          productId: c.productId,
          variantId: c.variantId,
          productName: c.productName,
          hsnOrSacCode: c.hsnOrSacCode,
          uqcCode: c.uqcCode,
          gstRateBps: c.gstRateBps,
          returnedQuantity: deltaQty,
          grossReversal: deltaGross,
          discountReversal: deltaDiscount,
          taxableReversal: deltaTaxable,
          cgstReversal: deltaCgst,
          sgstReversal: deltaSgst,
          igstReversal: deltaIgst,
          cessReversal: deltaCess,
          totalTaxReversal: deltaTotalTax,
          totalCreditLine: deltaCredit,
        });
      }

      // No new delta → idempotent (re-run with nothing new since last CN).
      if (reversals.length === 0) {
        const latest = priorCreditNotes[0] ?? null;
        return { kind: 'idempotent' as const, latest };
      }

      // Aggregate header totals.
      let taxableTotal = 0n;
      let cgstTotal = 0n;
      let sgstTotal = 0n;
      let igstTotal = 0n;
      let cessTotal = 0n;
      let totalTaxTotal = 0n;
      let creditTotal = 0n;
      for (const r of reversals) {
        taxableTotal += r.taxableReversal;
        cgstTotal += r.cgstReversal;
        sgstTotal += r.sgstReversal;
        igstTotal += r.igstReversal;
        cessTotal += r.cessReversal;
        totalTaxTotal += r.totalTaxReversal;
        creditTotal += r.totalCreditLine;
      }

      const roundOff = computeInvoiceRoundOff(creditTotal);
      const magnitude =
        roundOff.roundedAmountInPaise < 0n
          ? -roundOff.roundedAmountInPaise
          : roundOff.roundedAmountInPaise;
      // Phase 164 (#9) — a CN is a credit, not an invoice: prefix the words
      // so the PDF / ledger reads "Credit of Rupees ... Only".
      const amountInWords = `Credit of ${paiseToInvoiceWords(magnitude)}`;

      const fy = DocumentSequenceService.financialYearOf(now);
      // Phase 164 (review fix) — allocate the CN number on the SAME tx
      // connection (inside the advisory lock), not a second pooled
      // connection: avoids pool starvation under concurrent generation and
      // rolls the number back if this transaction aborts.
      const numberAlloc = await this.docSequence.nextNumber(
        {
          supplierGstin: sourceInvoice.supplierGstin,
          financialYear: fy,
          documentType: 'CREDIT_NOTE',
        },
        tx,
      );

      const cn = await tx.taxDocument.create({
        data: {
          documentNumber: numberAlloc.documentNumber,
          documentType: 'CREDIT_NOTE',
          financialYear: fy,
          masterOrderId: sourceInvoice.masterOrderId,
          subOrderId: sourceInvoice.subOrderId,
          sellerId: sourceInvoice.sellerId,
          customerId: sourceInvoice.customerId,
          supplierType: sourceInvoice.supplierType,
          invoiceType: sourceInvoice.invoiceType,
          supplierGstin: sourceInvoice.supplierGstin,
          sellerRegistrationType: sourceInvoice.sellerRegistrationType,
          sellerLegalName: sourceInvoice.sellerLegalName,
          sellerAddressJson: sourceInvoice.sellerAddressJson as Prisma.InputJsonValue,
          sellerStateCode: sourceInvoice.sellerStateCode,
          buyerGstin: sourceInvoice.buyerGstin,
          buyerLegalName: sourceInvoice.buyerLegalName,
          billingAddressJson: sourceInvoice.billingAddressJson as Prisma.InputJsonValue,
          shippingAddressJson: sourceInvoice.shippingAddressJson as Prisma.InputJsonValue,
          placeOfSupplyStateCode: sourceInvoice.placeOfSupplyStateCode,
          reverseChargeApplicable: sourceInvoice.reverseChargeApplicable,
          reverseChargeReason: sourceInvoice.reverseChargeReason,
          taxableAmountInPaise: taxableTotal,
          cgstAmountInPaise: cgstTotal,
          sgstAmountInPaise: sgstTotal,
          igstAmountInPaise: igstTotal,
          totalTaxAmountInPaise: totalTaxTotal,
          // Phase 164 (#8) — real cess reversal (was hardcoded 0n).
          cessAmountInPaise: cessTotal,
          roundOffAmountInPaise: roundOff.roundOffInPaise,
          documentTotalInPaise: roundOff.roundedAmountInPaise,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: sourceInvoice.paymentMode,
          originalDocumentId: sourceInvoice.id,
          originalDocumentNumber: sourceInvoice.documentNumber,
          // Phase 164 (#2/#3) — structured return linkage + always keep the
          // return number in the reason (belt-and-braces vs the old text-only
          // discriminator, even when an admin supplies a custom reason).
          returnId,
          reason: options.reason
            ? `Return ${returnRow.returnNumber} — ${options.reason}`
            : `Return ${returnRow.returnNumber}`,
          // Phase 164 (#14) — how many approved lines were skipped for lack
          // of a snapshot (0 = complete coverage).
          partialCoverageLineCount: skippedLineCount,
          status: 'PDF_PENDING',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: now,
        },
      });

      for (let i = 0; i < reversals.length; i++) {
        const r = reversals[i]!;
        await tx.taxDocumentLine.create({
          data: {
            documentId: cn.id,
            sourceSnapshotId: r.sourceSnapshotId,
            lineNumber: i + 1,
            lineType: 'PRODUCT',
            productId: r.productId,
            variantId: r.variantId,
            productName: r.productName,
            hsnOrSacCode: r.hsnOrSacCode,
            uqcCode: r.uqcCode,
            quantity: new Prisma.Decimal(r.returnedQuantity),
            // `grossAmountInPaise` is the canonical line value. `unitPriceInPaise`
            // is a presentation convenience via BigInt floor-division and may
            // drift up to (returnedQuantity − 1) paise from gross; auditors
            // reconcile on grossAmountInPaise, NOT unitPrice × quantity (#18).
            unitPriceInPaise:
              r.returnedQuantity > 0
                ? r.grossReversal / BigInt(r.returnedQuantity)
                : 0n,
            grossAmountInPaise: r.grossReversal,
            discountAmountInPaise: r.discountReversal,
            taxableAmountInPaise: r.taxableReversal,
            gstRateBps: r.gstRateBps,
            cgstAmountInPaise: r.cgstReversal,
            sgstAmountInPaise: r.sgstReversal,
            igstAmountInPaise: r.igstReversal,
            totalTaxAmountInPaise: r.totalTaxReversal,
            // Phase 164 (#8) — per-line cess reversal.
            cessAmountInPaise: r.cessReversal,
            lineTotalInPaise: r.totalCreditLine,
            currencyCode: 'INR',
          },
        });
      }

      return {
        kind: 'inserted' as const,
        cn,
        taxableTotal,
        cgstTotal,
        sgstTotal,
        igstTotal,
        cessTotal,
        totalTaxTotal,
        creditTotal,
      };
    });

    // 8. Handle the idempotent / no-eligible-lines outcomes.
    if (txResult.kind === 'idempotent') {
      if (!txResult.latest) {
        throw new Error(
          `Return ${returnRow.returnNumber}: no eligible lines for credit-note reversal ` +
            `(all approved items lacked snapshots or had invalid quantities).`,
        );
      }
      const latest = txResult.latest;
      return {
        creditNote: {
          id: latest.id,
          documentNumber: latest.documentNumber,
          documentTotalInPaise: latest.documentTotalInPaise,
          taxableReversalInPaise: latest.taxableAmountInPaise,
          totalTaxReversalInPaise: latest.totalTaxAmountInPaise,
        },
        sourceInvoice: {
          id: sourceInvoice.id,
          documentNumber: sourceInvoice.documentNumber,
          statusAfter: sourceInvoice.status,
        },
        isNew: false,
      };
    }

    const cn = txResult.cn;

    // 9. Transition source invoice status based on cumulative reversal
    //    across ALL non-cancelled credit notes for it.
    const allCreditNotes = await this.prisma.taxDocument.findMany({
      where: {
        documentType: 'CREDIT_NOTE',
        originalDocumentId: sourceInvoice.id,
        status: { notIn: ['VOIDED_DRAFT'] },
      },
      select: { taxableAmountInPaise: true },
    });
    const cumulativeReversed = allCreditNotes.reduce(
      (sum, n) => sum + n.taxableAmountInPaise,
      0n,
    );
    let nextStatus: TaxDocumentStatus = sourceInvoice.status;
    if (cumulativeReversed >= sourceInvoice.taxableAmountInPaise) {
      nextStatus = 'FULLY_REVERSED';
    } else if (cumulativeReversed > 0n) {
      nextStatus = 'PARTIALLY_REVERSED';
    }
    if (nextStatus !== sourceInvoice.status) {
      // Phase 164 (review fix) — the CN is already committed; a failure to
      // flip the (purely derivative) source-invoice status must NOT fail an
      // otherwise-valid credit note. The status is re-derived from the
      // cumulative reversal on every CN issuance, and GSTR-1 §9B / GSTR-3B
      // read the CN rows directly (not this flag), so a transient failure is
      // reconcilable and does not affect filings. Log loudly for ops.
      try {
        await this.taxDocument.transitionStatus({
          documentId: sourceInvoice.id,
          toStatus: nextStatus,
          reason: `Credit note ${cn.documentNumber} applied (return ${returnRow.returnNumber})`,
          actorId,
        });
      } catch (err) {
        nextStatus = sourceInvoice.status;
        this.logger.error(
          `Credit note ${cn.documentNumber} was issued but the source-invoice ` +
            `${sourceInvoice.documentNumber} status transition failed: ` +
            `${(err as Error).message}. The CN is valid; the invoice status will ` +
            `be re-derived on the next CN or needs manual reconciliation.`,
        );
      }
    }

    this.logger.log(
      `Credit note ${cn.documentNumber} (${(txResult.creditTotal / 100n).toString()} ₹ approx) ` +
        `issued for return ${returnRow.returnNumber} against invoice ${sourceInvoice.documentNumber}. ` +
        `Source invoice status: ${sourceInvoice.status} → ${nextStatus}.`,
    );

    // 10. Phase 164 (#4) — compliance audit trail.
    try {
      await this.audit.writeAuditLog({
        actorId,
        actorRole: 'SYSTEM',
        action: CREDIT_NOTE_EVENTS.ISSUED,
        module: 'tax',
        resource: 'tax_document',
        resourceId: cn.id,
        newValue: {
          documentNumber: cn.documentNumber,
          returnId,
          returnNumber: returnRow.returnNumber,
          sourceInvoiceId: sourceInvoice.id,
          taxableReversalInPaise: txResult.taxableTotal.toString(),
          totalTaxReversalInPaise: txResult.totalTaxTotal.toString(),
          cessReversalInPaise: txResult.cessTotal.toString(),
          documentTotalInPaise: cn.documentTotalInPaise.toString(),
          partialCoverageLineCount: skippedLineCount,
        },
        metadata: {
          sourceInvoiceStatusAfter: nextStatus,
          isManualOverride: options.actorId != null && options.actorId !== SYSTEM_CREDIT_NOTE_ACTOR,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Credit-note audit-log write failed for ${cn.documentNumber}: ${(err as Error).message} — CN was issued correctly.`,
      );
    }

    // 11. Phase 164 (#19) — durable domain event for downstream consumers.
    this.emitIssued({
      creditNoteId: cn.id,
      documentNumber: cn.documentNumber,
      returnId,
      returnNumber: returnRow.returnNumber,
      sourceInvoiceId: sourceInvoice.id,
      sourceInvoiceNumber: sourceInvoice.documentNumber,
      customerId: cn.customerId,
      sellerId: cn.sellerId,
      taxableReversalInPaise: txResult.taxableTotal.toString(),
      totalTaxReversalInPaise: txResult.totalTaxTotal.toString(),
      cessReversalInPaise: txResult.cessTotal.toString(),
      documentTotalInPaise: cn.documentTotalInPaise.toString(),
      isB2b: sourceInvoice.invoiceType === 'B2B' && !!sourceInvoice.buyerGstin,
      buyerGstin: sourceInvoice.buyerGstin,
      partialCoverageLineCount: skippedLineCount,
    });

    // 12. Customer notifications — best-effort, post-commit. Phase 164 (#20):
    //     stamp customerNotifiedAt when the issued-notification fires so
    //     support can answer "did the customer get it?".
    let notified = false;
    try {
      await this.notifications.customerCreditNoteIssued({
        customerId: returnRow.customerId,
        documentId: cn.id,
        documentNumber: cn.documentNumber,
        documentTotalInPaise: cn.documentTotalInPaise,
        originalInvoiceNumber: sourceInvoice.documentNumber,
        returnNumber: returnRow.returnNumber,
      });
      notified = true;

      if (sourceInvoice.invoiceType === 'B2B' && sourceInvoice.buyerGstin) {
        await this.notifications.customerB2bItcReversalRequired({
          customerId: returnRow.customerId,
          documentId: cn.id,
          documentNumber: cn.documentNumber,
          originalInvoiceNumber: sourceInvoice.documentNumber,
          originalInvoiceDate: sourceInvoice.generatedAt,
          buyerGstin: sourceInvoice.buyerGstin,
          cgstReversalInPaise: txResult.cgstTotal,
          sgstReversalInPaise: txResult.sgstTotal,
          igstReversalInPaise: txResult.igstTotal,
          totalTaxReversalInPaise: txResult.totalTaxTotal,
          returnNumber: returnRow.returnNumber,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Credit-note notifications failed for return ${returnRow.returnNumber}: ` +
          `${(err as Error).message} — CN was issued correctly; the issued event ` +
          `(${CREDIT_NOTE_EVENTS.ISSUED}) is the durable retry path.`,
      );
    }
    if (notified) {
      await this.prisma.taxDocument
        .update({ where: { id: cn.id }, data: { customerNotifiedAt: new Date() } })
        .catch(() => undefined);
    }

    return {
      creditNote: {
        id: cn.id,
        documentNumber: cn.documentNumber,
        documentTotalInPaise: cn.documentTotalInPaise,
        taxableReversalInPaise: txResult.taxableTotal,
        totalTaxReversalInPaise: txResult.totalTaxTotal,
      },
      sourceInvoice: {
        id: sourceInvoice.id,
        documentNumber: sourceInvoice.documentNumber,
        statusAfter: nextStatus,
      },
      isNew: true,
    };
  }

  /**
   * Sum already-credited reversal per source snapshot ID across the given
   * prior credit notes. Snapshots map 1:1 to order items.
   */
  private async aggregatePriorReversals(
    tx: Prisma.TransactionClient,
    priorCreditNoteIds: string[],
  ): Promise<
    Map<
      string,
      {
        taxable: bigint;
        cgst: bigint;
        sgst: bigint;
        igst: bigint;
        cess: bigint;
        totalTax: bigint;
        gross: bigint;
        discount: bigint;
        creditTotal: bigint;
        quantity: number;
      }
    >
  > {
    const map = new Map<
      string,
      {
        taxable: bigint;
        cgst: bigint;
        sgst: bigint;
        igst: bigint;
        cess: bigint;
        totalTax: bigint;
        gross: bigint;
        discount: bigint;
        creditTotal: bigint;
        quantity: number;
      }
    >();
    if (priorCreditNoteIds.length === 0) return map;
    const priorLines = await tx.taxDocumentLine.findMany({
      where: { documentId: { in: priorCreditNoteIds } },
    });
    for (const line of priorLines) {
      if (!line.sourceSnapshotId) continue;
      const agg = map.get(line.sourceSnapshotId) ?? {
        taxable: 0n,
        cgst: 0n,
        sgst: 0n,
        igst: 0n,
        cess: 0n,
        totalTax: 0n,
        gross: 0n,
        discount: 0n,
        creditTotal: 0n,
        quantity: 0,
      };
      agg.taxable += line.taxableAmountInPaise;
      agg.cgst += line.cgstAmountInPaise;
      agg.sgst += line.sgstAmountInPaise;
      agg.igst += line.igstAmountInPaise;
      agg.cess += line.cessAmountInPaise;
      agg.totalTax += line.totalTaxAmountInPaise;
      agg.gross += line.grossAmountInPaise;
      agg.discount += line.discountAmountInPaise;
      agg.creditTotal += line.lineTotalInPaise;
      agg.quantity += Number(line.quantity);
      map.set(line.sourceSnapshotId, agg);
    }
    return map;
  }

  /** Phase 164 (#19) — fire-and-forget domain event (never blocks issuance). */
  private emitIssued(payload: {
    creditNoteId: string;
    documentNumber: string;
    returnId: string;
    returnNumber: string;
    sourceInvoiceId: string;
    sourceInvoiceNumber: string;
    customerId: string | null;
    sellerId: string | null;
    taxableReversalInPaise: string;
    totalTaxReversalInPaise: string;
    cessReversalInPaise: string;
    documentTotalInPaise: string;
    isB2b: boolean;
    buyerGstin: string | null;
    partialCoverageLineCount: number;
  }): void {
    if (!this.eventBus) return;
    void this.eventBus
      .publish({
        eventName: CREDIT_NOTE_EVENTS.ISSUED,
        aggregate: 'TaxDocument',
        aggregateId: payload.creditNoteId,
        occurredAt: new Date(),
        payload,
      })
      .catch((err) =>
        this.logger.warn(
          `Failed to publish ${CREDIT_NOTE_EVENTS.ISSUED} for ${payload.documentNumber}: ${(err as Error).message}`,
        ),
      );
  }
}
