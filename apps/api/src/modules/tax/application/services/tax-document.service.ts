// Phase 9 of the GST/tax/invoice system — TaxDocumentService.
//
// Orchestrates the creation of a single legal tax document per
// SubOrder. The PDF rendering itself is intentionally out-of-scope
// for Phase 9 — `status` ends at `PDF_PENDING` and Phase 19's PDF
// retry processor turns HTML → PDF + uploads to S3.
//
// Sequence:
//   1. Idempotency: if a non-cancelled document already exists for
//      this SubOrder, return it. Same applies on retry.
//   2. Load SubOrderTaxSummary + lines (OrderItemTaxSnapshot rows).
//   3. Load seller / platform GSTIN context (legal name + address +
//      registration type) — supplier identity snapshot for Section 31.
//   4. Load customer + buyer GSTIN — recipient identity snapshot.
//   5. Decide documentType via `pickDocumentType`.
//   6. Allocate document number via DocumentSequenceService.
//   7. Compute round-off → grand total → amount-in-words.
//   8. Persist tax_documents + tax_document_lines in a transaction.
//   9. Mark status = PDF_PENDING (PDF rendered in Phase 19).
//   10. Emit `tax.document.generated` event for downstream (notifications,
//       ledger writers).
//
// See:
//   - docs/tax/CA.md §A Phase 9 log + §6.1 Section 31 hooks
//   - docs/tax/INVOICE_CANCELLATION_POLICY.md (status semantics)
//   - docs/tax/HSN_RATE_POLICY.md (HSN/UQC on lines)

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { EWayBillService } from './eway-bill.service';
import {
  DocumentSequenceService,
} from './document-sequence.service';
import {
  pickDocumentType,
  type DocumentTypePickerResult,
} from '../../domain/document-type-picker';
import { paiseToInvoiceWords } from '../../domain/amount-in-words';
import { computeInvoiceRoundOff } from '../../domain/round-off';
import {
  assertTransitionAllowed,
  isIssuedStatus,
} from '../../domain/tax-document-state-machine';
import {
  Prisma,
  type DocumentType,
  type GstRegistrationType,
  type SupplierType,
  type InvoiceType,
  type TaxDocumentStatus,
} from '@prisma/client';

export interface GenerateForSubOrderOptions {
  /**
   * If true, generates even when a non-cancelled document already
   * exists for this sub-order (creates a superseding document and
   * marks the prior one SUPERSEDED). Default false.
   */
  forceNew?: boolean;
  /**
   * Override the "system" actor for audit purposes (admin manual
   * triggers vs scheduled jobs).
   */
  actorId?: string | null;
}

export interface GenerateResult {
  document: { id: string; documentNumber: string; documentType: DocumentType };
  isNew: boolean;
  reason: string;
}

@Injectable()
export class TaxDocumentService {
  private readonly logger = new Logger(TaxDocumentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly docSequence: DocumentSequenceService,
    private readonly ewayBill: EWayBillService,
  ) {}

  /**
   * Generate (or return existing) tax document for one SubOrder.
   * Idempotent unless `options.forceNew` is true.
   */
  async generateForSubOrder(
    subOrderId: string,
    options: GenerateForSubOrderOptions = {},
  ): Promise<GenerateResult> {
    // 1. Idempotency check.
    if (!options.forceNew) {
      const existing = await this.prisma.taxDocument.findFirst({
        where: {
          subOrderId,
          status: {
            notIn: ['VOIDED_DRAFT', 'SUPERSEDED', 'FULLY_REVERSED'],
          },
          documentType: {
            in: ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE_CUM_BILL_OF_SUPPLY'],
          },
        },
        select: { id: true, documentNumber: true, documentType: true },
        orderBy: { generatedAt: 'desc' },
      });
      if (existing) {
        return {
          document: existing,
          isNew: false,
          reason: 'A non-cancelled document already exists for this sub-order.',
        };
      }
    }

    // 2. Load SubOrderTaxSummary + lines.
    const summary = await this.prisma.subOrderTaxSummary.findUnique({
      where: { subOrderId },
    });
    if (!summary) {
      throw new Error(
        `Cannot generate document: no SubOrderTaxSummary for sub-order ${subOrderId}. ` +
        `Run TaxSnapshotService.createSnapshotsForMasterOrder first.`,
      );
    }

    const snapshots = await this.prisma.orderItemTaxSnapshot.findMany({
      where: { subOrderId },
      orderBy: [{ lineType: 'asc' }, { createdAt: 'asc' }],
    });
    if (snapshots.length === 0) {
      throw new Error(`No tax-line snapshots for sub-order ${subOrderId}`);
    }

    // 3. Load sub-order + master + seller + customer context.
    const subOrder = await this.prisma.subOrder.findUnique({
      where: { id: subOrderId },
      select: {
        id: true,
        sellerId: true,
        franchiseId: true,
        fulfillmentNodeType: true,
        masterOrder: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            paymentMethod: true,
            shippingAddressSnapshot: true,
          },
        },
      },
    });
    if (!subOrder) throw new Error(`SubOrder ${subOrderId} not found`);

    // Supplier identity.
    let supplierGstin: string | null = null;
    let sellerLegalName: string | null = null;
    let sellerAddressJson: unknown = null;
    let sellerStateCode: string | null = null;
    let sellerRegistrationType: GstRegistrationType | null = null;

    if (summary.supplierType === 'MARKETPLACE_SELLER' && subOrder.sellerId) {
      const seller = await this.prisma.seller.findUnique({
        where: { id: subOrder.sellerId },
        select: {
          gstin: true,
          legalBusinessName: true,
          registeredBusinessAddressJson: true,
          gstStateCode: true,
          gstRegistrationType: true,
          sellerName: true,
          sellerShopName: true,
        },
      });
      if (seller) {
        supplierGstin = seller.gstin;
        sellerLegalName = seller.legalBusinessName ?? seller.sellerShopName ?? seller.sellerName;
        sellerAddressJson = seller.registeredBusinessAddressJson;
        sellerStateCode = seller.gstStateCode;
        sellerRegistrationType = seller.gstRegistrationType;
      }
    } else if (summary.supplierType === 'FRANCHISE' && subOrder.franchiseId) {
      // Franchise has gstNumber / panNumber but not the full new
      // supplier model yet. Read what's available.
      // Prisma model is `FranchisePartner`; `prisma.franchise` does not
      // exist (would runtime-crash any FRANCHISE supplier invoice).
      const franchise = await this.prisma.franchisePartner.findUnique({
        where: { id: subOrder.franchiseId },
        select: {
          gstNumber: true,
          panNumber: true,
          state: true,
          // Franchises don't yet have legalBusinessName field; use franchise name.
          franchiseCode: true,
          ownerName: true,
          businessName: true,
        },
      });
      if (franchise) {
        supplierGstin = franchise.gstNumber;
        sellerLegalName = franchise.businessName ?? franchise.ownerName ?? franchise.franchiseCode;
        sellerStateCode = franchise.state;
        sellerRegistrationType = 'REGULAR';
      }
    } else {
      // OWN_BRAND / SPORTSMART → load platform GST profile.
      const platform = await this.prisma.platformGstProfile.findFirst({
        where: { isDefault: true, isActive: true },
      });
      if (platform) {
        supplierGstin = platform.gstin;
        sellerLegalName = platform.legalBusinessName;
        sellerAddressJson = platform.registeredAddressJson;
        sellerStateCode = platform.gstStateCode;
        sellerRegistrationType = platform.registrationType;
      }
    }

    // Recipient identity (customer).
    // Phase 37 — checkout may have picked a non-default profile. The
    // selectedTaxProfileId snapshot wins when present; otherwise we
    // fall back to whatever profile is currently isDefault.
    const selectedProfileId = (subOrder.masterOrder as any).selectedTaxProfileId as
      | string
      | null
      | undefined;
    let customerProfile = selectedProfileId
      ? await this.prisma.customerTaxProfile.findFirst({
          where: {
            id: selectedProfileId,
            customerId: subOrder.masterOrder.customerId,
          },
        })
      : null;
    if (!customerProfile) {
      customerProfile = await this.prisma.customerTaxProfile.findFirst({
        where: { customerId: subOrder.masterOrder.customerId, isDefault: true },
      });
    }
    const customer = await this.prisma.user.findUnique({
      where: { id: subOrder.masterOrder.customerId },
      select: { id: true, firstName: true, lastName: true, email: true },
    });

    const buyerGstin = customerProfile?.gstin ?? null;
    const invoiceType: InvoiceType = buyerGstin ? 'B2B' : 'B2C';
    const buyerLegalName =
      customerProfile?.legalName ??
      (customer ? `${customer.firstName} ${customer.lastName}`.trim() : null);
    const billingAddressJson =
      customerProfile?.billingAddressJson ?? subOrder.masterOrder.shippingAddressSnapshot;

    // 4. Decide document type.
    const hasTaxableLines = snapshots.some(
      (s) =>
        s.supplyTaxability === 'TAXABLE' || s.supplyTaxability === 'ZERO_RATED',
    );
    const hasExemptLines = snapshots.some(
      (s) =>
        s.supplyTaxability === 'NIL_RATED' ||
        s.supplyTaxability === 'EXEMPT' ||
        s.supplyTaxability === 'NON_GST' ||
        s.supplyTaxability === 'OUT_OF_SCOPE',
    );
    const typeDecision: DocumentTypePickerResult = pickDocumentType({
      sellerRegistrationType,
      hasTaxableLines,
      hasExemptLines,
    });
    const documentType = typeDecision.documentType;

    // 5. Allocate number.
    const fy = DocumentSequenceService.financialYearOf(new Date());
    const numberAlloc = await this.docSequence.nextNumber({
      supplierGstin,
      financialYear: fy,
      documentType,
    });

    // 6. Compute round-off + totals + amount-in-words.
    const rawTotalInPaise =
      summary.taxableAmountInPaise +
      summary.totalTaxAmountInPaise +
      summary.cessAmountInPaise;
    const roundOff = computeInvoiceRoundOff(rawTotalInPaise);
    const amountInWords = paiseToInvoiceWords(
      roundOff.roundedAmountInPaise < 0n ? -roundOff.roundedAmountInPaise : roundOff.roundedAmountInPaise,
    );

    // 7. Persist document + lines in one tx.
    const doc = await this.prisma.$transaction(async (tx) => {
      // If forceNew with an existing doc, mark the prior SUPERSEDED
      // — but only for statuses the state machine actually permits
      // (GENERATED / PDF_PENDING / PDF_GENERATED / PDF_FAILED /
      // PARTIALLY_REVERSED). Terminal statuses (FULLY_REVERSED,
      // SUPERSEDED, VOIDED_DRAFT) cannot be re-superseded.
      if (options.forceNew) {
        await tx.taxDocument.updateMany({
          where: {
            subOrderId,
            status: {
              in: [
                'GENERATED',
                'PDF_PENDING',
                'PDF_GENERATED',
                'PDF_FAILED',
                'PARTIALLY_REVERSED',
              ],
            },
            documentType: {
              in: ['TAX_INVOICE', 'BILL_OF_SUPPLY', 'INVOICE_CUM_BILL_OF_SUPPLY'],
            },
          },
          data: { status: 'SUPERSEDED' },
        });
      }

      const created = await tx.taxDocument.create({
        data: {
          documentNumber: numberAlloc.documentNumber,
          documentType,
          financialYear: fy,
          masterOrderId: subOrder.masterOrder.id,
          subOrderId: subOrder.id,
          sellerId: subOrder.sellerId,
          customerId: subOrder.masterOrder.customerId,
          supplierType: summary.supplierType ?? ('MARKETPLACE_SELLER' as SupplierType),
          invoiceType,

          supplierGstin,
          sellerRegistrationType,
          sellerLegalName,
          sellerAddressJson: sellerAddressJson as Prisma.InputJsonValue,
          sellerStateCode,

          buyerGstin,
          buyerLegalName,
          billingAddressJson: (billingAddressJson ?? null) as Prisma.InputJsonValue,
          shippingAddressJson: subOrder.masterOrder.shippingAddressSnapshot as Prisma.InputJsonValue,
          placeOfSupplyStateCode: summary.placeOfSupplyStateCode,

          reverseChargeApplicable: false, // RCM is off by default for B2C goods
          reverseChargeReason: null,

          taxableAmountInPaise: summary.taxableAmountInPaise,
          cgstAmountInPaise: summary.cgstAmountInPaise,
          sgstAmountInPaise: summary.sgstAmountInPaise,
          igstAmountInPaise: summary.igstAmountInPaise,
          totalTaxAmountInPaise: summary.totalTaxAmountInPaise,
          cessAmountInPaise: summary.cessAmountInPaise,
          roundOffAmountInPaise: roundOff.roundOffInPaise,
          documentTotalInPaise: roundOff.roundedAmountInPaise,
          amountInWords,
          currencyCode: 'INR',
          paymentMode: subOrder.masterOrder.paymentMethod ?? null,

          status: 'PDF_PENDING',
          einvoiceStatus: 'NOT_APPLICABLE',
          generatedAt: new Date(),
        },
      });

      // Lines — one per snapshot. lineNumber follows snapshot order.
      for (let i = 0; i < snapshots.length; i++) {
        const s = snapshots[i]!;

        await tx.taxDocumentLine.create({
          data: {
            documentId: created.id,
            sourceSnapshotId: s.id,
            lineNumber: i + 1,
            lineType: s.lineType,
            productId: s.productId,
            variantId: s.variantId,
            productName: s.description ?? 'Item',
            sku: null,
            hsnOrSacCode: s.hsnCode,
            uqcCode: s.uqcCode,
            quantity: s.quantity ?? new Prisma.Decimal(1),
            unitPriceInPaise:
              s.quantity && Number(s.quantity) > 0
                ? s.grossLineAmountInPaise / BigInt(Math.floor(Number(s.quantity)))
                : s.grossLineAmountInPaise,
            grossAmountInPaise: s.grossLineAmountInPaise,
            discountAmountInPaise: s.discountAmountInPaise,
            taxableAmountInPaise: s.taxableAmountInPaise,
            gstRateBps: s.gstRateBps,
            cgstAmountInPaise: s.cgstAmountInPaise,
            sgstAmountInPaise: s.sgstAmountInPaise,
            igstAmountInPaise: s.igstAmountInPaise,
            totalTaxAmountInPaise: s.totalTaxAmountInPaise,
            cessAmountInPaise: s.cessAmountInPaise,
            lineTotalInPaise: s.lineTotalAfterDiscountAndTaxInPaise,
            currencyCode: 'INR',
          },
        });
      }

      return created;
    });

    this.logger.log(
      `Generated ${documentType} ${doc.documentNumber} (FY ${fy}) for sub-order ${subOrderId}: ${typeDecision.reason}`,
    );

    // Fire EWB classification post-commit so the e-way bill queue picks
    // up the sub-order automatically. Best-effort: never block invoice
    // generation on a classification failure — admins can still manually
    // hit POST /admin/tax/eway-bills/sub-order/:id/generate, which classifies
    // internally on its own.
    try {
      await this.ewayBill.classifyForSubOrder(subOrderId);
    } catch (err) {
      this.logger.warn(
        `EWB classification failed for sub-order ${subOrderId} after invoice ${doc.documentNumber}: ${(err as Error).message}`,
      );
    }

    return {
      document: { id: doc.id, documentNumber: doc.documentNumber, documentType: doc.documentType },
      isNew: true,
      reason: typeDecision.reason,
    };
  }

  /**
   * Phase 10 — generic status transition gated by the FSM.
   * Refuses forbidden transitions (e.g. GENERATED → VOIDED_DRAFT,
   * any → DRAFT, anything from a terminal state).
   *
   * For Section 34 reductions, use the credit-note path (Phase 11)
   * which transitions the source document to PARTIALLY_REVERSED or
   * FULLY_REVERSED through this method.
   */
  async transitionStatus(input: {
    documentId: string;
    toStatus: TaxDocumentStatus;
    reason?: string;
    actorId?: string | null;
  }): Promise<void> {
    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, status: true, documentNumber: true, documentType: true },
    });
    if (!doc) throw new Error(`TaxDocument ${input.documentId} not found`);

    assertTransitionAllowed(doc.status, input.toStatus);

    if (doc.status === input.toStatus) {
      // Idempotent self-transition
      return;
    }

    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        status: input.toStatus,
        cancelledAt: input.toStatus === 'VOIDED_DRAFT' ? new Date() : undefined,
        reason: input.reason ?? undefined,
      },
    });
    this.logger.log(
      `TaxDocument ${doc.documentNumber} (${doc.documentType}) ${doc.status} → ${input.toStatus}` +
        (input.reason ? `: ${input.reason}` : '') +
        (input.actorId ? ` by ${input.actorId}` : ''),
    );
  }

  /**
   * Phase 10 — emergency void for a DRAFT document that was never
   * legally issued.
   *
   * Indian GST law forbids voiding an issued tax document; reductions
   * happen via CREDIT_NOTE. This path exists only for the rare case
   * where engineering / admin produced a DRAFT row (no shipment, no
   * customer-facing copy) that needs throwing away.
   *
   * Behaviour:
   *   - Refuses to void anything past DRAFT (FSM enforces).
   *   - If the document already had a number allocated, calls
   *     `DocumentSequenceService.markSkipped` so the burnt number
   *     appears in the audit JSON. (Current generation path doesn't
   *     produce DRAFT-with-number rows, but future preview flows
   *     might.)
   *
   * Requires `tax.override` permission on the calling admin path.
   */
  async voidDraft(input: {
    documentId: string;
    reason: string;
    actorId: string;
  }): Promise<void> {
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error('voidDraft requires a non-trivial reason (≥3 chars) for the audit trail');
    }

    const doc = await this.prisma.taxDocument.findUnique({
      where: { id: input.documentId },
      select: {
        id: true,
        status: true,
        documentNumber: true,
        documentType: true,
        supplierGstin: true,
        financialYear: true,
      },
    });
    if (!doc) throw new Error(`TaxDocument ${input.documentId} not found`);

    if (isIssuedStatus(doc.status)) {
      throw new Error(
        `Cannot void issued document ${doc.documentNumber} (status=${doc.status}). ` +
          `Issue a CREDIT_NOTE for the full value via Phase 11 service instead.`,
      );
    }

    // FSM gate.
    assertTransitionAllowed(doc.status, 'VOIDED_DRAFT');

    await this.prisma.taxDocument.update({
      where: { id: doc.id },
      data: {
        status: 'VOIDED_DRAFT',
        cancelledAt: new Date(),
        reason: input.reason,
      },
    });

    // Burn the number in the sequence audit. The current generation
    // path always allocates a number before the row reaches DB, so
    // every voided draft has a number to record.
    if (doc.documentNumber && doc.documentNumber.includes('-')) {
      const lastNumberStr = doc.documentNumber.split('-').pop()!;
      const lastNumber = parseInt(lastNumberStr, 10);
      if (Number.isFinite(lastNumber)) {
        const sequenceKey = DocumentSequenceService.sequenceKeyOf(
          doc.supplierGstin,
          doc.financialYear,
          doc.documentType,
        );
        await this.docSequence.markSkipped(
          sequenceKey,
          lastNumber,
          `VOIDED_DRAFT by ${input.actorId}: ${input.reason}`,
        );
      }
    }

    this.logger.warn(
      `Voided draft ${doc.documentNumber} (${doc.documentType}) by ${input.actorId}: ${input.reason}`,
    );
  }
}
