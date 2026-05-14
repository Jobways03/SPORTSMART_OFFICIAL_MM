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
// Idempotency: re-running for the same returnId returns the existing
// credit note (one credit note per return — partial QC re-approvals
// are deferred to a future enhancement).
//
// See:
//   - docs/tax/CREDIT_NOTE_TIME_BAR_POLICY.md
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md
//   - docs/tax/CA.md §6.2 Section 34

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import { TaxDocumentService } from './tax-document.service';
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
      throw new Error(
        `No active source tax invoice found for sub-order ${returnRow.subOrderId}. ` +
          `Run TaxDocumentService.generateForSubOrder before issuing a credit note.`,
      );
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

    // 5. Idempotency — return existing credit note for this return,
    //    if any.
    const existing = await this.prisma.taxDocument.findFirst({
      where: {
        documentType: 'CREDIT_NOTE',
        // Cross-reference the source invoice.
        originalDocumentId: sourceInvoice.id,
        reason: { contains: returnRow.returnNumber },
        status: { notIn: ['VOIDED_DRAFT'] },
      },
    });
    if (existing) {
      return {
        creditNote: {
          id: existing.id,
          documentNumber: existing.documentNumber,
          documentTotalInPaise: existing.documentTotalInPaise,
          taxableReversalInPaise: existing.taxableAmountInPaise,
          totalTaxReversalInPaise: existing.totalTaxAmountInPaise,
        },
        sourceInvoice: {
          id: sourceInvoice.id,
          documentNumber: sourceInvoice.documentNumber,
          statusAfter: sourceInvoice.status,
        },
        isNew: false,
      };
    }

    // 6. Per-line proportional reversal.
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

      const r = calculateGstReversal({
        originalGrossInPaise: snapshot.grossLineAmountInPaise,
        originalDiscountInPaise: snapshot.discountAmountInPaise,
        originalCgstInPaise: snapshot.cgstAmountInPaise,
        originalSgstInPaise: snapshot.sgstAmountInPaise,
        originalIgstInPaise: snapshot.igstAmountInPaise,
        purchasedQuantity: purchasedQty,
        returnedQuantity: returnedQty,
      });

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
        returnedQuantity: returnedQty,
        grossReversal: r.grossReturnedInPaise,
        discountReversal: r.discountReversalInPaise,
        taxableReversal: r.taxableReversalInPaise,
        cgstReversal: r.cgstReversalInPaise,
        sgstReversal: r.sgstReversalInPaise,
        igstReversal: r.igstReversalInPaise,
        totalTaxReversal: r.totalTaxReversalInPaise,
        totalCreditLine: r.totalCreditNoteInPaise,
      });
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
        const r = reversals[i];
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
