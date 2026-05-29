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
//      compute proportional reversal via `calculateGstReversal`,
//      write a CreditNoteLine.
//   5. Allocate CREDIT_NOTE number via DocumentSequenceService.
//   6. Persist `tax_documents` (documentType=CREDIT_NOTE) + lines.
//   7. Transition source invoice via `TaxDocumentService.transitionStatus`
//      to PARTIALLY_REVERSED or FULLY_REVERSED based on cumulative
//      reversal.
//
// Idempotency (Phase 30 — multi-cycle): re-running for the same return
// computes the DELTA between the cumulative reversal already credited
// across prior credit notes and the reversal the current QC-approved
// state implies. If the delta is zero (re-call with no new approvals
// since last CN), the most recent CN is returned. If the delta is non-
// zero (a QC re-approval added more reversible quantity, or a previously
// pending line was cleared), a NEW credit note is generated covering
// only that delta. This supports the realistic flow where a return
// gets QC'd in stages — e.g. 2 of 3 returned units approved on day 1,
// the third approved on day 5 after re-inspection.
//
// See:
//   - docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md
//   - docs/tax/CA.md §6.2 Section 34

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import { TaxDocumentService } from './tax-document.service';
import { TaxNotificationService } from './tax-notification.service';
import { paiseToInvoiceWords } from '../../domain/amount-in-words';
import { computeInvoiceRoundOff } from '../../domain/round-off';
import {
  isWithinSection34Window,
  section34CutoffFor,
} from '../../domain/credit-note-time-bar';
import { calculateGstReversal } from '../../../discounts/domain/tax/calculate-gst';
import {
  Prisma,
  type TaxDocumentStatus,
} from '@prisma/client';

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

@Injectable()
export class CreditNoteService {
  private readonly logger = new Logger(CreditNoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docSequence: DocumentSequenceService,
    private readonly taxDocument: TaxDocumentService,
    // Phase 31 — fires customerCreditNoteIssued always and
    // customerB2bItcReversalRequired when the source invoice was B2B.
    // Both are best-effort and non-throwing inside the notification
    // service, so a notify failure can't crash CN issuance.
    private readonly notifications: TaxNotificationService,
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

    // 1. Load return + items.
    const returnRow = await this.prisma.return.findUnique({
      where: { id: returnId },
      include: {
        items: true,
      },
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
        documentType: {
          in: ['TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY'],
        },
        // Skip terminal SUPERSEDED / VOIDED_DRAFT
        status: {
          notIn: ['VOIDED_DRAFT', 'SUPERSEDED'],
        },
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

    // 5. Find all prior credit notes for this return so we can compute
    //    per-snapshot deltas. The discriminator is
    //    `originalDocumentId + reason contains returnNumber` — the same
    //    filter used for the no-change idempotency check at the end.
    const priorCreditNotes = await this.prisma.taxDocument.findMany({
      where: {
        documentType: 'CREDIT_NOTE',
        originalDocumentId: sourceInvoice.id,
        reason: { contains: returnRow.returnNumber },
        status: { notIn: ['VOIDED_DRAFT'] },
      },
      orderBy: { generatedAt: 'desc' },
      include: {
        // Lines carry sourceSnapshotId — that's how we attribute
        // already-credited amounts back to the original order items.
        // (the include shape is the public delegate name; if Prisma
        // refuses the literal, the manual two-step at line ~210
        // re-fetches by documentId.)
      },
    });

    // Sum already-credited reversal per source snapshot ID. Snapshots
    // map 1:1 to order items, so this gives us "how much taxable +
    // tax + quantity has already been reversed for each line".
    const priorReversalsBySnapshot = new Map<
      string,
      {
        taxable: bigint;
        cgst: bigint;
        sgst: bigint;
        igst: bigint;
        totalTax: bigint;
        gross: bigint;
        discount: bigint;
        creditTotal: bigint;
        quantity: number;
      }
    >();
    if (priorCreditNotes.length > 0) {
      const priorIds = priorCreditNotes.map((cn) => cn.id);
      const priorLines = await this.prisma.taxDocumentLine.findMany({
        where: { documentId: { in: priorIds } },
      });
      for (const line of priorLines) {
        if (!line.sourceSnapshotId) continue;
        const agg = priorReversalsBySnapshot.get(line.sourceSnapshotId) ?? {
          taxable: 0n,
          cgst: 0n,
          sgst: 0n,
          igst: 0n,
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
        agg.totalTax += line.totalTaxAmountInPaise;
        agg.gross += line.grossAmountInPaise;
        agg.discount += line.discountAmountInPaise;
        agg.creditTotal += line.lineTotalInPaise;
        agg.quantity += Number(line.quantity);
        priorReversalsBySnapshot.set(line.sourceSnapshotId, agg);
      }
    }

    // 6. Per-line proportional reversal — DELTA computation.
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
      totalTaxReversal: bigint;
      totalCreditLine: bigint;
    }

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

    const reversals: LineReversal[] = [];
    for (const item of approvedItems) {
      const snapshot = snapshotByOrderItemId.get(item.orderItemId);
      if (!snapshot) {
        this.logger.warn(
          `Return ${returnRow.returnNumber}: no OrderItemTaxSnapshot for orderItem ${item.orderItemId} — skipping (legacy order; no GST reversal possible)`,
        );
        continue;
      }
      const sourceLine = sourceLineBySnapshotId.get(snapshot.id);
      if (!sourceLine) {
        this.logger.warn(
          `Return ${returnRow.returnNumber}: no TaxDocumentLine for snapshot ${snapshot.id} — skipping`,
        );
        continue;
      }

      // Need original purchased quantity. The snapshot has it (Phase 5
      // added quantity Decimal column); fall back to OrderItem.quantity.
      const orderItem = await this.prisma.orderItem.findUnique({
        where: { id: item.orderItemId },
        select: { quantity: true },
      });
      const purchasedQty = orderItem?.quantity ?? 1;
      const returnedQty = item.qcQuantityApproved ?? 0;
      if (returnedQty <= 0 || returnedQty > purchasedQty) {
        this.logger.warn(
          `Return ${returnRow.returnNumber}: invalid returnedQty=${returnedQty} vs purchasedQty=${purchasedQty} for item ${item.orderItemId}`,
        );
        continue;
      }

      // Cumulative reversal implied by the CURRENT QC-approved state.
      const cumulative = calculateGstReversal({
        originalGrossInPaise: snapshot.grossLineAmountInPaise,
        originalDiscountInPaise: snapshot.discountAmountInPaise,
        originalCgstInPaise: snapshot.cgstAmountInPaise,
        originalSgstInPaise: snapshot.sgstAmountInPaise,
        originalIgstInPaise: snapshot.igstAmountInPaise,
        purchasedQuantity: purchasedQty,
        returnedQuantity: returnedQty,
      });

      // Subtract whatever's already been credited across prior CNs for
      // this snapshot. Result is the delta this new CN should carry.
      const prior = priorReversalsBySnapshot.get(snapshot.id);
      const deltaQty = returnedQty - (prior?.quantity ?? 0);
      if (deltaQty <= 0) {
        // This line was fully (or over-) credited already — skip it.
        continue;
      }
      const deltaGross = cumulative.grossReturnedInPaise - (prior?.gross ?? 0n);
      const deltaDiscount =
        cumulative.discountReversalInPaise - (prior?.discount ?? 0n);
      const deltaTaxable =
        cumulative.taxableReversalInPaise - (prior?.taxable ?? 0n);
      const deltaCgst = cumulative.cgstReversalInPaise - (prior?.cgst ?? 0n);
      const deltaSgst = cumulative.sgstReversalInPaise - (prior?.sgst ?? 0n);
      const deltaIgst = cumulative.igstReversalInPaise - (prior?.igst ?? 0n);
      const deltaTotalTax =
        cumulative.totalTaxReversalInPaise - (prior?.totalTax ?? 0n);
      const deltaCredit =
        cumulative.totalCreditNoteInPaise - (prior?.creditTotal ?? 0n);

      // Defensive: skip lines where every monetary delta is zero
      // (quantity bumped but value didn't — shouldn't happen but cheap
      // to guard).
      if (
        deltaGross === 0n &&
        deltaTaxable === 0n &&
        deltaTotalTax === 0n &&
        deltaCredit === 0n
      ) {
        continue;
      }

      reversals.push({
        orderItemId: item.orderItemId,
        sourceLineId: sourceLine.id,
        sourceSnapshotId: snapshot.id,
        productId: snapshot.productId,
        variantId: snapshot.variantId,
        productName: snapshot.description ?? sourceLine.productName,
        hsnOrSacCode: snapshot.hsnCode,
        uqcCode: snapshot.uqcCode,
        gstRateBps: snapshot.gstRateBps,
        returnedQuantity: deltaQty,
        grossReversal: deltaGross,
        discountReversal: deltaDiscount,
        taxableReversal: deltaTaxable,
        cgstReversal: deltaCgst,
        sgstReversal: deltaSgst,
        igstReversal: deltaIgst,
        totalTaxReversal: deltaTotalTax,
        totalCreditLine: deltaCredit,
      });
    }

    // If no per-line delta survived, the caller is re-running the
    // generator with no new QC-approved quantity since the last credit
    // note. Idempotent: return the most-recent CN.
    if (reversals.length === 0 && priorCreditNotes.length > 0) {
      const latest = priorCreditNotes[0]!;

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

    if (reversals.length === 0) {
      throw new Error(
        `Return ${returnRow.returnNumber}: no eligible lines for credit-note reversal ` +
          `(all approved items lacked snapshots or had invalid quantities).`,
      );
    }

    // 7. Aggregate totals for credit-note header.
    let taxableTotal = 0n;
    let cgstTotal = 0n;
    let sgstTotal = 0n;
    let igstTotal = 0n;
    let totalTaxTotal = 0n;
    let grossTotal = 0n;
    let creditTotal = 0n;
    for (const r of reversals) {
      taxableTotal += r.taxableReversal;
      cgstTotal += r.cgstReversal;
      sgstTotal += r.sgstReversal;
      igstTotal += r.igstReversal;
      totalTaxTotal += r.totalTaxReversal;
      grossTotal += r.grossReversal;
      creditTotal += r.totalCreditLine;
    }

    const roundOff = computeInvoiceRoundOff(creditTotal);
    const amountInWords = paiseToInvoiceWords(
      roundOff.roundedAmountInPaise < 0n
        ? -roundOff.roundedAmountInPaise
        : roundOff.roundedAmountInPaise,
    );

    // 8. Allocate CREDIT_NOTE number under the same supplier GSTIN
    //    as the source invoice (so the series is supplier-scoped).
    const fy = DocumentSequenceService.financialYearOf(now);
    const numberAlloc = await this.docSequence.nextNumber({
      supplierGstin: sourceInvoice.supplierGstin,
      financialYear: fy,
      documentType: 'CREDIT_NOTE',
    });

    // 9. Persist credit note + lines + transition source invoice.
    const result = await this.prisma.$transaction(async (tx) => {
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

          // Supplier + recipient snapshot — mirror the source invoice
          // so the credit note can stand alone for legal review.
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

          // Money: positive amounts representing reversal magnitude.
          taxableAmountInPaise: taxableTotal,
          cgstAmountInPaise: cgstTotal,
          sgstAmountInPaise: sgstTotal,
          igstAmountInPaise: igstTotal,
          totalTaxAmountInPaise: totalTaxTotal,
          cessAmountInPaise: 0n,
          roundOffAmountInPaise: roundOff.roundOffInPaise,
          documentTotalInPaise: roundOff.roundedAmountInPaise,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: sourceInvoice.paymentMode,

          // Cross-reference
          originalDocumentId: sourceInvoice.id,
          originalDocumentNumber: sourceInvoice.documentNumber,
          reason: options.reason ?? `Return ${returnRow.returnNumber}`,

          status: 'PDF_PENDING',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: now,
        },
      });

      // Lines mirror source line numbering structure but renumber from 1.
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
            // `grossAmountInPaise` IS THE CANONICAL VALUE on a credit-
            // note line. `unitPriceInPaise` is a presentation
            // convenience computed by BigInt floor-division and may
            // drift up to (returnedQuantity − 1) paise from the gross
            // due to rounding. Auditors reconciling line totals MUST
            // sum grossAmountInPaise — reconstructing via unitPrice ×
            // quantity is informational only.
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
            cessAmountInPaise: 0n,
            lineTotalInPaise: r.totalCreditLine,
            currencyCode: 'INR',
          },
        });
      }

      return cn;
    });

    // 10. Transition source invoice status based on cumulative reversal.
    //
    // Cumulative reversed taxable across ALL non-cancelled credit notes
    // for this source invoice. If equals source taxable → FULLY_REVERSED;
    // else > 0 → PARTIALLY_REVERSED.
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
      // Will throw if FSM forbids — should not happen since the source
      // is in a non-terminal issued state.
      await this.taxDocument.transitionStatus({
        documentId: sourceInvoice.id,
        toStatus: nextStatus,
        reason: `Credit note ${result.documentNumber} applied (return ${returnRow.returnNumber})`,
        actorId: options.actorId ?? null,
      });
    }

    this.logger.log(
      `Credit note ${result.documentNumber} (${(creditTotal / 100n).toString()} ₹ approx) ` +
        `issued for return ${returnRow.returnNumber} against invoice ${sourceInvoice.documentNumber}. ` +
        `Source invoice status: ${sourceInvoice.status} → ${nextStatus}.`,
    );

    // Phase 31 — customer notifications. Fired post-commit and after
    // the source invoice's FSM transition so a notify failure can't
    // affect the persisted state. The notification service is
    // non-throwing internally; this try/catch is belt + braces.
    try {
      await this.notifications.customerCreditNoteIssued({
        customerId: returnRow.customerId,
        documentId: result.id,
        documentNumber: result.documentNumber,
        documentTotalInPaise: result.documentTotalInPaise,
        originalInvoiceNumber: sourceInvoice.documentNumber,
        returnNumber: returnRow.returnNumber,
      });

      // B2B sales (buyer had a GSTIN on the source invoice) trigger
      // the additional ITC-reversal demand email. The buyer is
      // legally required to reverse the corresponding ITC under
      // GSTR-3B Table 4(B) once the credit note appears in their
      // GSTR-2B; this email puts the per-leg amounts on record.
      if (sourceInvoice.invoiceType === 'B2B' && sourceInvoice.buyerGstin) {
        await this.notifications.customerB2bItcReversalRequired({
          customerId: returnRow.customerId,
          documentId: result.id,
          documentNumber: result.documentNumber,
          originalInvoiceNumber: sourceInvoice.documentNumber,
          originalInvoiceDate: sourceInvoice.generatedAt,
          buyerGstin: sourceInvoice.buyerGstin,
          cgstReversalInPaise: cgstTotal,
          sgstReversalInPaise: sgstTotal,
          igstReversalInPaise: igstTotal,
          totalTaxReversalInPaise: totalTaxTotal,
          returnNumber: returnRow.returnNumber,
        });
      }
    } catch (err) {
      this.logger.warn(
        `Credit-note notifications failed for return ${returnRow.returnNumber}: ` +
          `${(err as Error).message} — CN was issued correctly; email retry ` +
          `is the notifications module's responsibility.`,
      );
    }

    return {
      creditNote: {
        id: result.id,
        documentNumber: result.documentNumber,
        documentTotalInPaise: result.documentTotalInPaise,
        taxableReversalInPaise: taxableTotal,
        totalTaxReversalInPaise: totalTaxTotal,
      },
      sourceInvoice: {
        id: sourceInvoice.id,
        documentNumber: sourceInvoice.documentNumber,
        statusAfter: nextStatus,
      },
      isNew: true,
    };
  }
}
