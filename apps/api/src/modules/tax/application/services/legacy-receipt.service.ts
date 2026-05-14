// Phase 14 GST — LegacyReceiptService.
//
// Generates a `LEGACY_RECEIPT` tax_document for orders that predate
// the GST module (no OrderItemTaxSnapshot rows + no TaxDocument).
//
// Legacy receipts are EXPLICITLY non-tax documents:
//   - Carry the gross amount the customer paid (from sub-order totals).
//   - Carry NO GST breakdown (cgst/sgst/igst all 0, taxableAmount = 0).
//   - Use the PLATFORM-scoped sequence (supplierGstin = NULL) since we
//     don't have a seller GSTIN snapshot for historical orders.
//   - Are marked `einvoiceStatus = NOT_APPLICABLE` permanently.
//   - Status lands at GENERATED directly (no PDF_PENDING — the receipt
//     can be rendered on demand from this row alone).
//
// Why we need them:
//   1. Customer-side: a legacy customer who asks for a receipt of an
//      old order can be handed something — not a tax invoice (we don't
//      have the GST data), but a record that the transaction happened.
//   2. Refund-path completeness: Phase 12's eligibility classifier +
//      Phase 13's wallet adjustment service both currently route to
//      REQUIRES_FINANCE_REVIEW when no source invoice exists. With a
//      LEGACY_RECEIPT in place, the lookup succeeds and the wallet
//      adjustment row carries a stable `sourceTaxDocumentId` for audit.
//   3. Reports completeness: GSTR-1 / 3B (Phase 18) filter by document
//      type — legacy receipts are excluded from GST output reports,
//      and a dedicated "legacy receipts issued in period" line gives
//      the CA visibility of the pre-GST tail.
//
// What this service does NOT do:
//   - Retroactively compute GST on legacy orders. We don't have HSN/
//     rate metadata for those line items and any reconstruction would
//     be a guess. The CA decision in §3 explicitly excludes back-filing.
//   - Replace a real TAX_INVOICE. If a legacy order's sub-order has
//     been fully migrated (snapshots written via a backfill), the
//     regular invoice flow takes over.
//
// See:
//   - docs/tax/CA.md §A Phase 14 log
//   - docs/tax/CA.md §3 row "Legacy orders + GST"

import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TaxDocument } from '@prisma/client';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DocumentSequenceService } from './document-sequence.service';
import { paiseToInvoiceWords } from '../../domain/amount-in-words';

export interface GenerateLegacyReceiptResult {
  document: Pick<
    TaxDocument,
    'id' | 'documentNumber' | 'documentTotalInPaise' | 'status'
  >;
  isNew: boolean;
}

@Injectable()
export class LegacyReceiptService {
  private readonly logger = new Logger(LegacyReceiptService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docSequence: DocumentSequenceService,
  ) {}

  /**
   * True when the sub-order has NO OrderItemTaxSnapshot rows AND NO
   * existing non-cancelled TaxDocument. Used by the eligibility service
   * + wallet-adjustment service to decide between "real invoice expected"
   * and "this is a legacy order, route through legacy path".
   */
  async isLegacyOrder(subOrderId: string): Promise<boolean> {
    // Cheap check first: any tax document at all?
    const anyDoc = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        status: { notIn: ['VOIDED_DRAFT'] },
      },
      select: { id: true, documentType: true },
    });
    if (anyDoc && anyDoc.documentType !== 'LEGACY_RECEIPT') {
      // A real invoice exists → not legacy.
      return false;
    }

    // No invoice yet — check if any line has a tax snapshot. Even one
    // snapshot means the new flow ran for this sub-order; this is a
    // "snapshot exists but invoice never generated" case (an open
    // sub-order, mid-checkout). Not legacy — TaxDocumentService should
    // handle it.
    const items = await this.prisma.orderItem.findMany({
      where: { subOrderId },
      select: { id: true, taxSnapshot: { select: { id: true } } },
    });
    if (items.length === 0) {
      // No items at all — pathological; treat as not-legacy so the
      // caller surfaces the error path.
      return false;
    }
    const anyWithSnapshot = items.some((it) => it.taxSnapshot != null);
    return !anyWithSnapshot;
  }

  /**
   * Generate (or return existing) LEGACY_RECEIPT for a sub-order.
   * Idempotent: a second call returns the existing receipt with
   * `isNew = false`.
   */
  async generateForSubOrder(
    subOrderId: string,
  ): Promise<GenerateLegacyReceiptResult> {
    // Idempotency — return existing LEGACY_RECEIPT if any.
    const existing = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        documentType: 'LEGACY_RECEIPT',
        status: { notIn: ['VOIDED_DRAFT'] },
      },
    });
    if (existing) {
      return {
        document: {
          id: existing.id,
          documentNumber: existing.documentNumber,
          documentTotalInPaise: existing.documentTotalInPaise,
          status: existing.status,
        },
        isNew: false,
      };
    }

    // Refuse if a real (tax-aware) document exists — the regular invoice
    // service owns those sub-orders.
    const realDoc = await this.prisma.taxDocument.findFirst({
      where: {
        subOrderId,
        documentType: { not: 'LEGACY_RECEIPT' },
        status: { notIn: ['VOIDED_DRAFT'] },
      },
      select: { id: true, documentType: true, documentNumber: true },
    });
    if (realDoc) {
      throw new Error(
        `Sub-order ${subOrderId} already has a ${realDoc.documentType} ` +
          `(${realDoc.documentNumber}); LEGACY_RECEIPT not applicable.`,
      );
    }

    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      include: {
        masterOrder: {
          select: {
            id: true,
            customerId: true,
            customer: {
              select: { firstName: true, lastName: true, email: true },
            },
          },
        },
        items: {
          select: {
            id: true,
            productId: true,
            variantId: true,
            productTitle: true,
            variantTitle: true,
            quantity: true,
            unitPriceInPaise: true,
            totalPriceInPaise: true,
          },
        },
      },
    });
    if (!subOrder) throw new Error(`SubOrder ${subOrderId} not found`);
    if (subOrder.items.length === 0) {
      throw new Error(
        `SubOrder ${subOrderId} has no items; legacy receipt skipped.`,
      );
    }

    // Aggregate the gross total from line items. We use this rather
    // than `subOrder.subTotalInPaise` so the receipt totals match what
    // the line table shows; the two should agree but the line sum is
    // the more defensible audit number.
    const documentTotal = subOrder.items.reduce(
      (sum, it) => sum + it.totalPriceInPaise,
      0n,
    );

    const now = new Date();
    const fy = DocumentSequenceService.financialYearOf(now);
    const numberAlloc = await this.docSequence.nextNumber({
      // LEGACY_RECEIPT lives in the PLATFORM-scoped series.
      supplierGstin: null,
      financialYear: fy,
      documentType: 'LEGACY_RECEIPT',
    });

    const buyerName = formatBuyerName(subOrder.masterOrder.customer);
    const amountInWords = paiseToInvoiceWords(documentTotal);

    const created = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.taxDocument.create({
        data: {
          documentNumber: numberAlloc.documentNumber,
          documentType: 'LEGACY_RECEIPT',
          financialYear: fy,
          masterOrderId: subOrder.masterOrderId,
          subOrderId: subOrder.id,
          sellerId: subOrder.sellerId,
          customerId: subOrder.masterOrder.customerId,
          supplierType: 'SPORTSMART',
          invoiceType: null,

          // No supplier identity — by design.
          supplierGstin: null,
          sellerRegistrationType: null,
          sellerLegalName: null,
          sellerAddressJson: undefined as unknown as Prisma.InputJsonValue,
          sellerStateCode: null,

          buyerGstin: null,
          buyerLegalName: buyerName,
          billingAddressJson: undefined as unknown as Prisma.InputJsonValue,
          shippingAddressJson: undefined as unknown as Prisma.InputJsonValue,
          placeOfSupplyStateCode: null,

          reverseChargeApplicable: false,

          // No GST claim — every tax field is 0.
          taxableAmountInPaise: 0n,
          cgstAmountInPaise: 0n,
          sgstAmountInPaise: 0n,
          igstAmountInPaise: 0n,
          totalTaxAmountInPaise: 0n,
          cessAmountInPaise: 0n,
          roundOffAmountInPaise: 0n,
          documentTotalInPaise: documentTotal,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: null,

          reason: 'Pre-GST-module legacy order; non-tax receipt issued.',

          status: 'GENERATED',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: now,
        },
      });

      // Lines mirror the order items 1:1 but with all tax columns
      // zero. The HSN / rate columns stay null — we don't know them.
      for (let i = 0; i < subOrder.items.length; i++) {
        const it = subOrder.items[i];
        await tx.taxDocumentLine.create({
          data: {
            documentId: doc.id,
            sourceSnapshotId: null,
            lineNumber: i + 1,
            lineType: 'PRODUCT',
            productId: it.productId,
            variantId: it.variantId,
            productName:
              [it.productTitle, it.variantTitle].filter(Boolean).join(' — ') ||
              it.productTitle,
            hsnOrSacCode: null,
            uqcCode: null,
            quantity: new Prisma.Decimal(it.quantity),
            unitPriceInPaise: it.unitPriceInPaise,
            grossAmountInPaise: it.totalPriceInPaise,
            discountAmountInPaise: 0n,
            taxableAmountInPaise: 0n,
            gstRateBps: 0,
            cgstAmountInPaise: 0n,
            sgstAmountInPaise: 0n,
            igstAmountInPaise: 0n,
            totalTaxAmountInPaise: 0n,
            cessAmountInPaise: 0n,
            lineTotalInPaise: it.totalPriceInPaise,
            currencyCode: 'INR',
          },
        });
      }

      return doc;
    });

    this.logger.log(
      `LEGACY_RECEIPT ${created.documentNumber} issued for sub-order ` +
        `${subOrderId} (total ${documentTotal.toString()} paise, ` +
        `${subOrder.items.length} line(s))`,
    );

    return {
      document: {
        id: created.id,
        documentNumber: created.documentNumber,
        documentTotalInPaise: created.documentTotalInPaise,
        status: created.status,
      },
      isNew: true,
    };
  }
}

function formatBuyerName(
  customer:
    | { firstName: string | null; lastName: string | null; email: string | null }
    | null
    | undefined,
): string | null {
  if (!customer) return null;
  const full = [customer.firstName, customer.lastName]
    .filter((s): s is string => !!s && s.length > 0)
    .join(' ')
    .trim();
  return full || customer.email || null;
}
